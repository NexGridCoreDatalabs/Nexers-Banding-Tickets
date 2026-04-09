-- RetiFlux™ — Zone clerk notifications (all clerks: SM notify, FL available, etc.)
-- Run in Supabase SQL Editor after replenishment_tasks exists.

CREATE TABLE IF NOT EXISTS zone_clerk_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_zone text NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz NULL,
  read_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NULL
);

CREATE INDEX IF NOT EXISTS zone_clerk_notifications_target_idx
  ON zone_clerk_notifications(target_zone)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS zone_clerk_notifications_created_idx
  ON zone_clerk_notifications(created_at DESC);

COMMENT ON COLUMN zone_clerk_notifications.target_zone IS
  'NULL = broadcast to all zone clerks (show on every portal). Otherwise match authorized_users.assigned_zone.';

ALTER TABLE zone_clerk_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zone_clerk_notifications_anon_select" ON zone_clerk_notifications;
CREATE POLICY "zone_clerk_notifications_anon_select"
  ON zone_clerk_notifications FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "zone_clerk_notifications_anon_insert" ON zone_clerk_notifications;
CREATE POLICY "zone_clerk_notifications_anon_insert"
  ON zone_clerk_notifications FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "zone_clerk_notifications_anon_update" ON zone_clerk_notifications;
CREATE POLICY "zone_clerk_notifications_anon_update"
  ON zone_clerk_notifications FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- When a forklift goes busy -> available, broadcast so clerks can retry moves / tasks.
CREATE OR REPLACE FUNCTION trg_forklifts_notify_available()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'available'
     AND COALESCE(OLD.status, '') = 'busy' THEN
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_forklifts_notify_available ON forklifts;
CREATE TRIGGER trg_forklifts_notify_available
  AFTER UPDATE OF status ON forklifts
  FOR EACH ROW
  EXECUTE PROCEDURE trg_forklifts_notify_available();

-- When a forklift is assigned again (available -> busy), auto-dismiss matching
-- FORKLIFT_AVAILABLE rows so clerks are not misled that it is still idle.
CREATE OR REPLACE FUNCTION trg_forklifts_auto_dismiss_avail_notif()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'busy'
     AND COALESCE(OLD.status, '') = 'available' THEN
    UPDATE zone_clerk_notifications
    SET read_at = now(),
        read_by = 'system'
    WHERE kind = 'FORKLIFT_AVAILABLE'
      AND read_at IS NULL
      AND NULLIF(trim(payload->>'forklift_id'), '') IS NOT NULL
      AND (payload->>'forklift_id')::uuid = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_forklifts_auto_dismiss_avail_notif ON forklifts;
CREATE TRIGGER trg_forklifts_auto_dismiss_avail_notif
  AFTER UPDATE OF status ON forklifts
  FOR EACH ROW
  EXECUTE PROCEDURE trg_forklifts_auto_dismiss_avail_notif();

-- Optional: verify
-- SELECT * FROM zone_clerk_notifications ORDER BY created_at DESC LIMIT 20;

-- Forklift soft dispatch (queue + staging + merged "available" trigger):
-- Run **RUN_FORKLIFT_SOFT_DISPATCH.sql** after this file. It replaces
-- trg_forklifts_notify_available and trg_forklifts_auto_dismiss_avail_notif with versions
-- that assign staging / FORKLIFT_STAGING and consume the queue. Re-running THIS script alone
-- after soft dispatch would revert to basic FORKLIFT_AVAILABLE-only behavior.
