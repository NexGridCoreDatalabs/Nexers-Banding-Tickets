-- RetiFlux™ — Soft dispatch: queue move intents when no FL, assign staging when an FL frees up
-- Run AFTER: forklifts table, zone_clerk_notifications, RUN_ZONE_CLERK_NOTIFICATIONS (triggers exist).
-- This replaces trg_forklifts_notify_available body to prefer staging assignment over generic "available".

-- 1) Queue: one pending row per pallet (deduped in RPC)
CREATE TABLE IF NOT EXISTS forklift_staging_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pallet_id text NOT NULL,
  from_zone text NOT NULL,
  to_zone text NOT NULL,
  priority int NOT NULL DEFAULT 100,
  reason text NULL,
  requested_by text NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ASSIGNED', 'CONSUMED', 'CANCELLED')),
  assigned_forklift_id uuid NULL REFERENCES forklifts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz NULL,
  consumed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS forklift_staging_queue_pending_idx
  ON forklift_staging_queue(priority ASC, created_at ASC)
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS forklift_staging_queue_one_pending_per_pallet
  ON forklift_staging_queue(pallet_id)
  WHERE status = 'PENDING';

ALTER TABLE forklift_staging_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forklift_staging_queue_anon_all" ON forklift_staging_queue;
CREATE POLICY "forklift_staging_queue_anon_all"
  ON forklift_staging_queue FOR ALL TO anon USING (true) WITH CHECK (true);

COMMENT ON TABLE forklift_staging_queue IS
  'When movement_initiate fails for no forklift, clerk intent is queued; next matching FL picks it up and gets staging_target_zone.';

-- 2) Forklift staging hint (cleared when FL goes busy)
ALTER TABLE forklifts
  ADD COLUMN IF NOT EXISTS staging_target_zone text NULL,
  ADD COLUMN IF NOT EXISTS staging_queue_id uuid NULL REFERENCES forklift_staging_queue(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staging_set_at timestamptz NULL;

-- 3) Pick next queue row for this forklift pool and assign staging + zone notification
CREATE OR REPLACE FUNCTION pick_staging_queue_for_forklift(p_fl_id uuid)
RETURNS boolean AS $$
DECLARE
  v_fl forklifts%ROWTYPE;
  v_q RECORD;
  v_dispatch_fl boolean;
BEGIN
  IF p_fl_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_fl FROM forklifts WHERE id = p_fl_id FOR UPDATE;
  IF NOT FOUND OR v_fl.status IS DISTINCT FROM 'available' THEN
    RETURN false;
  END IF;

  v_dispatch_fl := v_fl.forklift_code IN ('FL-326', 'FL-327');

  SELECT q.* INTO v_q
  FROM forklift_staging_queue q
  WHERE q.status = 'PENDING'
    AND (
      (v_dispatch_fl
        AND q.from_zone = 'Dispatch Loading Area'
        AND q.to_zone IN ('Outbounding', 'QA Hold', 'Rework Zone'))
      OR
      (NOT v_dispatch_fl
        AND NOT (
          q.from_zone = 'Dispatch Loading Area'
          AND q.to_zone IN ('Outbounding', 'QA Hold', 'Rework Zone')
        ))
    )
  ORDER BY q.priority ASC, q.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE forklift_staging_queue
  SET status = 'ASSIGNED',
      assigned_forklift_id = p_fl_id,
      assigned_at = now()
  WHERE id = v_q.id;

  UPDATE forklifts
  SET staging_target_zone = v_q.from_zone,
      staging_queue_id = v_q.id,
      staging_set_at = now()
  WHERE id = p_fl_id;

  INSERT INTO zone_clerk_notifications (
    target_zone, kind, title, body, payload, created_by
  ) VALUES (
    v_q.from_zone,
    'FORKLIFT_STAGING',
    'Forklift proceed to zone',
    COALESCE(v_fl.forklift_code, v_fl.name, 'Forklift')
      || ' — go to '
      || v_q.from_zone
      || ' for a pending move (pallet '
      || v_q.pallet_id
      || ' → '
      || v_q.to_zone
      || '). Initiate when ready.',
    jsonb_build_object(
      'forklift_id', v_fl.id,
      'forklift_code', v_fl.forklift_code,
      'queue_id', v_q.id,
      'pallet_id', v_q.pallet_id,
      'from_zone', v_q.from_zone,
      'to_zone', v_q.to_zone
    ),
    'system'
  );

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- (Trigger-only; not granted to anon.)

-- 4) Replace "available" notifier: if staging matched, skip generic FORKLIFT_AVAILABLE blast
CREATE OR REPLACE FUNCTION trg_forklifts_notify_available()
RETURNS trigger AS $$
DECLARE
  v_staged boolean := false;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'available'
     AND COALESCE(OLD.status, '') = 'busy' THEN
    v_staged := pick_staging_queue_for_forklift(NEW.id);
    IF NOT v_staged THEN
      INSERT INTO zone_clerk_notifications (
        target_zone, kind, title, body, payload, created_by
      ) VALUES (
        NULL,
        'FORKLIFT_AVAILABLE',
        'Forklift available',
        COALESCE(NEW.forklift_code, NEW.name, 'Forklift') || ' is now available for assignment.',
        jsonb_build_object(
          'forklift_id', NEW.id,
          'forklift_code', NEW.forklift_code,
          'forklift_name', NEW.name
        ),
        'system'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_forklifts_notify_available ON forklifts;
CREATE TRIGGER trg_forklifts_notify_available
  AFTER UPDATE OF status ON forklifts
  FOR EACH ROW
  EXECUTE PROCEDURE trg_forklifts_notify_available();

-- 5) On busy: dismiss availability + staging toasts, consume queue row, clear staging columns
CREATE OR REPLACE FUNCTION trg_forklifts_auto_dismiss_avail_notif()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'busy'
     AND COALESCE(OLD.status, '') = 'available' THEN

    UPDATE zone_clerk_notifications
    SET read_at = now(),
        read_by = 'system'
    WHERE read_at IS NULL
      AND (
        (kind = 'FORKLIFT_AVAILABLE'
          AND NULLIF(trim(payload->>'forklift_id'), '') IS NOT NULL
          AND (payload->>'forklift_id')::uuid = NEW.id)
        OR
        (kind = 'FORKLIFT_STAGING'
          AND NULLIF(trim(payload->>'forklift_id'), '') IS NOT NULL
          AND (payload->>'forklift_id')::uuid = NEW.id)
      );

    IF NEW.staging_queue_id IS NOT NULL THEN
      UPDATE forklift_staging_queue
      SET status = 'CONSUMED', consumed_at = now()
      WHERE id = NEW.staging_queue_id AND status = 'ASSIGNED';
    END IF;

    UPDATE forklifts
    SET staging_target_zone = NULL,
        staging_queue_id = NULL,
        staging_set_at = NULL
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_forklifts_auto_dismiss_avail_notif ON forklifts;
CREATE TRIGGER trg_forklifts_auto_dismiss_avail_notif
  AFTER UPDATE OF status ON forklifts
  FOR EACH ROW
  EXECUTE PROCEDURE trg_forklifts_auto_dismiss_avail_notif();

-- 6) RPC: enqueue from zone clerk UI when initiate fails (no forklift)
CREATE OR REPLACE FUNCTION enqueue_forklift_staging_intent(
  p_pallet_id text,
  p_from_zone text,
  p_to_zone text,
  p_priority int DEFAULT 100,
  p_reason text DEFAULT '',
  p_requested_by text DEFAULT ''
)
RETURNS jsonb AS $$
DECLARE
  v_existing uuid;
  v_id uuid;
  pid text;
  fz text;
  tz text;
BEGIN
  pid := NULLIF(trim(p_pallet_id), '');
  fz := NULLIF(trim(p_from_zone), '');
  tz := NULLIF(trim(p_to_zone), '');
  IF pid IS NULL OR fz IS NULL OR tz IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'pallet_id, from_zone, and to_zone are required');
  END IF;

  SELECT id INTO v_existing
  FROM forklift_staging_queue
  WHERE status = 'PENDING' AND pallet_id = pid
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'deduped', true, 'queue_id', v_existing);
  END IF;

  INSERT INTO forklift_staging_queue (
    pallet_id, from_zone, to_zone, priority, reason, requested_by
  ) VALUES (
    pid, fz, tz,
    COALESCE(p_priority, 100),
    NULLIF(trim(p_reason), ''),
    NULLIF(trim(p_requested_by), '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'queue_id', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_forklift_staging_intent(text, text, text, int, text, text) TO anon;

-- Optional checks:
-- SELECT * FROM forklift_staging_queue ORDER BY created_at DESC LIMIT 20;
-- SELECT forklift_code, status, staging_target_zone FROM forklifts;
