-- RetiFlux™ — Forklift (FL) allocations
-- Migration 020: Run after 019.
-- Implements: forklifts table, forklift_id on zone_movements, auto-assign on movement_initiate,
--             assign_forklift_to_movement RPC.

-- Ensure movement ID generator exists (from RUN_MOVEMENT_SUPABASE)
CREATE OR REPLACE FUNCTION generate_movement_id()
RETURNS text AS $$
  SELECT 'MOV-' || to_char(now(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 10000)::text, 4, '0');
$$ LANGUAGE sql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. forklifts table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forklifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forklift_code text NOT NULL UNIQUE,
  name text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'busy', 'offline')),
  current_zone text,
  last_assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forklifts_status_idx ON forklifts(status) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS forklifts_code_idx ON forklifts(forklift_code);

ALTER TABLE forklifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "forklifts_anon_select" ON forklifts;
CREATE POLICY "forklifts_anon_select" ON forklifts FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "forklifts_anon_update" ON forklifts;
CREATE POLICY "forklifts_anon_update" ON forklifts FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add forklift_id to zone_movements
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE zone_movements ADD COLUMN IF NOT EXISTS forklift_id uuid REFERENCES forklifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS zone_movements_forklift_id_idx ON zone_movements(forklift_id) WHERE forklift_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. assign_forklift_to_movement(p_movement_id) — pick available FL, assign, mark busy
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assign_forklift_to_movement(p_movement_id text)
RETURNS jsonb AS $$
DECLARE
  v_mov zone_movements%ROWTYPE;
  v_fl forklifts%ROWTYPE;
BEGIN
  IF NULLIF(trim(p_movement_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing movement_id');
  END IF;

  SELECT * INTO v_mov FROM zone_movements WHERE movement_id = p_movement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Movement not found: ' || p_movement_id);
  END IF;

  IF v_mov.movement_status != 'In Transit' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Movement is not In Transit');
  END IF;

  IF v_mov.forklift_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'forklift_id', v_mov.forklift_id, 'already_assigned', true);
  END IF;

  SELECT * INTO v_fl FROM forklifts
  WHERE status = 'available'
  ORDER BY last_assigned_at ASC NULLS FIRST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No available forklift');
  END IF;

  UPDATE zone_movements SET forklift_id = v_fl.id WHERE movement_id = p_movement_id;
  UPDATE forklifts SET status = 'busy', last_assigned_at = now(), updated_at = now() WHERE id = v_fl.id;

  RETURN jsonb_build_object(
    'success', true,
    'forklift_id', v_fl.id,
    'forklift_code', v_fl.forklift_code,
    'forklift_name', v_fl.name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. release_forklift_from_movement(p_movement_id) — when movement received, mark FL available
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_forklift_from_movement(p_movement_id text)
RETURNS jsonb AS $$
DECLARE
  v_mov zone_movements%ROWTYPE;
  v_fl_id uuid;
BEGIN
  IF NULLIF(trim(p_movement_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing movement_id');
  END IF;

  SELECT forklift_id INTO v_fl_id FROM zone_movements WHERE movement_id = p_movement_id;
  IF v_fl_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'released', false, 'message', 'No forklift was assigned');
  END IF;

  UPDATE zone_movements SET forklift_id = NULL WHERE movement_id = p_movement_id;
  UPDATE forklifts SET status = 'available', updated_at = now() WHERE id = v_fl_id;

  RETURN jsonb_build_object('success', true, 'released', true, 'forklift_id', v_fl_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Extend movement_initiate: auto-assign forklift after insert
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION movement_initiate(
  p_pallet_id text,
  p_to_zone text,
  p_moved_by text,
  p_reason text DEFAULT '',
  p_override_reason text DEFAULT '',
  p_quantity numeric DEFAULT NULL,
  p_order_reference text DEFAULT ''
)
RETURNS jsonb AS $$
DECLARE
  v_pallet pallets%ROWTYPE;
  v_movement_id text;
  v_qty numeric;
  v_res jsonb;
  v_fl_res jsonb;
BEGIN
  IF NULLIF(trim(p_pallet_id), '') IS NULL OR NULLIF(trim(p_to_zone), '') IS NULL OR NULLIF(trim(p_moved_by), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing palletId, toZone, or movedBy');
  END IF;

  SELECT * INTO v_pallet FROM pallets WHERE pallet_id = p_pallet_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet not found: ' || p_pallet_id);
  END IF;

  IF v_pallet.in_transit_to_zone IS NOT NULL AND trim(v_pallet.in_transit_to_zone) != '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet is already in transit to ' || v_pallet.in_transit_to_zone);
  END IF;

  IF v_pallet.current_zone = p_to_zone THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet is already in ' || p_to_zone);
  END IF;

  v_qty := COALESCE(p_quantity, v_pallet.remaining_quantity, v_pallet.quantity);
  v_movement_id := generate_movement_id();

  INSERT INTO zone_movements (
    movement_id, pallet_id, from_zone, to_zone,
    movement_date, movement_time, moved_by, reason, override_reason,
    quantity, order_reference, movement_status
  ) VALUES (
    v_movement_id, p_pallet_id, v_pallet.current_zone, p_to_zone,
    current_date, current_time, p_moved_by, NULLIF(trim(p_reason), ''), NULLIF(trim(p_override_reason), ''),
    v_qty, NULLIF(trim(p_order_reference), ''), 'In Transit'
  );

  UPDATE pallets SET
    in_transit_to_zone = p_to_zone,
    in_transit_movement_id = v_movement_id,
    in_transit_initiated_at = now(),
    in_transit_initiated_by = p_moved_by,
    notes = CASE WHEN trim(p_reason) != '' THEN COALESCE(notes || E'\n', '') || '[Initiate] ' || p_reason ELSE notes END
  WHERE pallet_id = p_pallet_id;

  -- Auto-assign forklift (required). If none available, raise to rollback movement.
  v_fl_res := assign_forklift_to_movement(v_movement_id);
  IF COALESCE((v_fl_res->>'success')::boolean, false) = false THEN
    RAISE EXCEPTION 'No available forklift. Move cannot be initiated right now.';
  END IF;

  v_res := jsonb_build_object(
    'success', true,
    'message', 'Move initiated to ' || p_to_zone,
    'movementId', v_movement_id,
    'fromZone', v_pallet.current_zone
  );
  IF (v_fl_res->>'success')::boolean AND (v_fl_res->>'already_assigned') IS NULL THEN
    v_res := v_res || jsonb_build_object('forklift_code', v_fl_res->>'forklift_code', 'forklift_name', v_fl_res->>'forklift_name');
  END IF;

  RETURN v_res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Extend movement_receive: release forklift when movement completes
-- (movement_receive is in migration 010; we replace it here to add FL release)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION movement_receive(
  p_pallet_id text,
  p_received_by text
)
RETURNS jsonb AS $$
DECLARE
  v_pallet pallets%ROWTYPE;
  v_to_zone text;
  v_from_zone text;
  v_movement_id text;
  v_updated int;
BEGIN
  IF NULLIF(trim(p_pallet_id), '') IS NULL OR NULLIF(trim(p_received_by), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing palletId or receivedBy');
  END IF;

  SELECT * INTO v_pallet FROM pallets WHERE pallet_id = p_pallet_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet not found: ' || p_pallet_id);
  END IF;

  v_to_zone := NULLIF(trim(v_pallet.in_transit_to_zone), '');
  IF v_to_zone IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet is not in transit. Nothing to receive.');
  END IF;

  v_from_zone := v_pallet.current_zone;
  v_movement_id := NULLIF(trim(v_pallet.in_transit_movement_id), '');
  IF v_movement_id IS NULL THEN
    SELECT movement_id INTO v_movement_id FROM zone_movements WHERE pallet_id = p_pallet_id AND movement_status = 'In Transit' ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_movement_id IS NOT NULL THEN
    UPDATE zone_movements SET movement_status = 'Received', received_at = now(), received_by = p_received_by
    WHERE movement_id = v_movement_id AND movement_status = 'In Transit';
  ELSE
    UPDATE zone_movements SET movement_status = 'Received', received_at = now(), received_by = p_received_by
    WHERE pallet_id = p_pallet_id AND movement_status = 'In Transit';
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No matching In Transit movement for pallet. Pallet and zone_movements may be out of sync.'
    );
  END IF;

  IF v_movement_id IS NULL THEN
    SELECT movement_id INTO v_movement_id FROM zone_movements WHERE pallet_id = p_pallet_id AND movement_status = 'Received' ORDER BY received_at DESC LIMIT 1;
  END IF;
  IF v_movement_id IS NOT NULL THEN
    PERFORM release_forklift_from_movement(v_movement_id);
  END IF;

  UPDATE pallets SET
    current_zone = v_to_zone,
    in_transit_to_zone = NULL,
    in_transit_movement_id = NULL,
    in_transit_initiated_at = NULL,
    in_transit_initiated_by = NULL,
    last_moved_at = now(),
    last_moved_by = p_received_by
  WHERE pallet_id = p_pallet_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Pallet received at ' || v_to_zone,
    'palletId', p_pallet_id,
    'fromZone', v_from_zone,
    'toZone', v_to_zone
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Seed forklifts: FL-320 to FL-325 (warehouse), FL-326/FL-327 (dispatch)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO forklifts (forklift_code, name, status) VALUES
  ('FL-320', 'Forklift 320', 'available'),
  ('FL-321', 'Forklift 321', 'available'),
  ('FL-322', 'Forklift 322', 'available'),
  ('FL-323', 'Forklift 323', 'available'),
  ('FL-324', 'Forklift 324', 'available'),
  ('FL-325', 'Forklift 325', 'available'),
  ('FL-326', 'Dispatch FL 326', 'available'),
  ('FL-327', 'Dispatch FL 327', 'available')
ON CONFLICT (forklift_code) DO NOTHING;

GRANT EXECUTE ON FUNCTION assign_forklift_to_movement(text) TO anon;
GRANT EXECUTE ON FUNCTION release_forklift_from_movement(text) TO anon;
