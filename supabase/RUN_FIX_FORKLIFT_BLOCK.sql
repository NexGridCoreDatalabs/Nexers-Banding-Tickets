-- RetiFlux™ — Fix: forklift availability block on movement_initiate
--
-- ROOT CAUSE:
--   1) Forklifts get stuck in status='busy' when a movement was initiated but
--      movement_receive was never called (e.g. pallet was received informally,
--      or the movement was abandoned). The forklift never gets released.
--   2) movement_initiate hard-blocks (RAISE EXCEPTION + full rollback) when no
--      forklift is available, making it impossible to move pallets at all even
--      when forklifts are visibly idle in traffic-center.
--
-- FIX APPLIED:
--   Step 1 — One-time cleanup: release forklifts whose last movement is no
--             longer 'In Transit' (already received, cancelled, or orphaned).
--             This is the most likely root cause — forklifts visually idle but
--             stuck as 'busy' in the DB from moves that were never received.
--   Step 2 — Pool fallback in assign_forklift_to_movement: if the preferred
--             fleet pool is empty, try any available forklift across both pools
--             before returning 'not found'. Forklift assignment stays mandatory.
--   Step 3 — movement_initiate: forklift assignment is still required. The move
--             rolls back if no FL is free. Step 1 + 2 ensure this rarely fires.
--
-- Run once in Supabase SQL Editor.
-- Safe to re-run (all steps are idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Release stuck forklifts
-- ══════════════════════════════════════════════════════════════════════════════
-- Release any forklift marked 'busy' whose linked movement is no longer
-- 'In Transit' (already Received, Cancelled, or the link is broken/null).
UPDATE forklifts f
SET
  status          = 'available',
  updated_at      = now()
WHERE f.status = 'busy'
  AND NOT EXISTS (
    SELECT 1
    FROM   zone_movements zm
    WHERE  zm.forklift_id     = f.id
      AND  zm.movement_status = 'In Transit'
  );

-- Also auto-receive any movement stuck In Transit > 12 hours
-- (operator forgot to tap Receive — pallet is physically already there).
UPDATE zone_movements
SET
  movement_status = 'Received',
  received_at     = now(),
  received_by     = 'AUTO_REVERT_12H'
WHERE movement_status = 'In Transit'
  AND created_at < now() - interval '12 hours';

-- Release forklifts from those auto-received movements
UPDATE forklifts f
SET
  status     = 'available',
  updated_at = now()
WHERE f.status = 'busy'
  AND NOT EXISTS (
    SELECT 1
    FROM   zone_movements zm
    WHERE  zm.forklift_id     = f.id
      AND  zm.movement_status = 'In Transit'
  );

-- Update pallets whose in-transit movement was just auto-received
UPDATE pallets p
SET
  current_zone              = p.in_transit_to_zone,
  in_transit_to_zone        = NULL,
  in_transit_movement_id    = NULL,
  in_transit_initiated_at   = NULL,
  in_transit_initiated_by   = NULL,
  last_moved_at             = now(),
  last_moved_by             = 'AUTO_REVERT_12H'
WHERE p.in_transit_to_zone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM   zone_movements zm
    WHERE  zm.pallet_id       = p.pallet_id
      AND  zm.movement_status = 'In Transit'
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Fleet-aware assignment with graceful pool fallback
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION assign_forklift_to_movement(p_movement_id text)
RETURNS jsonb AS $$
DECLARE
  v_mov           zone_movements%ROWTYPE;
  v_fl            forklifts%ROWTYPE;
  v_dispatch_move boolean := false;
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

  -- Idempotent: already assigned
  IF v_mov.forklift_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'forklift_id', v_mov.forklift_id, 'already_assigned', true);
  END IF;

  -- Dispatch fleet: Dispatch Loading Area → Outbounding / QA Hold / Rework Zone
  v_dispatch_move :=
    v_mov.from_zone = 'Dispatch Loading Area'
    AND v_mov.to_zone IN ('Outbounding', 'QA Hold', 'Rework Zone');

  -- Try preferred pool first
  IF v_dispatch_move THEN
    SELECT * INTO v_fl
    FROM   forklifts
    WHERE  status = 'available'
      AND  forklift_code IN ('FL-326', 'FL-327')
    ORDER  BY last_assigned_at ASC NULLS FIRST
    FOR UPDATE SKIP LOCKED
    LIMIT  1;
  ELSE
    SELECT * INTO v_fl
    FROM   forklifts
    WHERE  status = 'available'
      AND  forklift_code NOT IN ('FL-326', 'FL-327')
    ORDER  BY last_assigned_at ASC NULLS FIRST
    FOR UPDATE SKIP LOCKED
    LIMIT  1;
  END IF;

  -- ── Graceful fallback: preferred pool empty → try any available forklift ──
  IF NOT FOUND THEN
    SELECT * INTO v_fl
    FROM   forklifts
    WHERE  status = 'available'
    ORDER  BY last_assigned_at ASC NULLS FIRST
    FOR UPDATE SKIP LOCKED
    LIMIT  1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No available forklift in any fleet pool');
  END IF;

  UPDATE zone_movements SET forklift_id = v_fl.id WHERE movement_id = p_movement_id;
  UPDATE forklifts SET status = 'busy', last_assigned_at = now(), updated_at = now() WHERE id = v_fl.id;

  RETURN jsonb_build_object(
    'success',       true,
    'forklift_id',   v_fl.id,
    'forklift_code', v_fl.forklift_code,
    'forklift_name', v_fl.name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION assign_forklift_to_movement(text) TO anon;

-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 3: movement_initiate — soft-fail on forklift, never block the move
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION movement_initiate(
  p_pallet_id        text,
  p_to_zone          text,
  p_moved_by         text,
  p_reason           text    DEFAULT '',
  p_override_reason  text    DEFAULT '',
  p_quantity         numeric DEFAULT NULL,
  p_order_reference  text    DEFAULT ''
)
RETURNS jsonb AS $$
DECLARE
  v_pallet      pallets%ROWTYPE;
  v_movement_id text;
  v_qty         numeric;
  v_res         jsonb;
  v_fl_res      jsonb;
BEGIN
  IF NULLIF(trim(p_pallet_id), '') IS NULL
     OR NULLIF(trim(p_to_zone),   '') IS NULL
     OR NULLIF(trim(p_moved_by),  '') IS NULL THEN
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

  v_qty         := COALESCE(p_quantity, v_pallet.remaining_quantity, v_pallet.quantity);
  v_movement_id := generate_movement_id();

  INSERT INTO zone_movements (
    movement_id, pallet_id, from_zone, to_zone,
    movement_date, movement_time, moved_by, reason, override_reason,
    quantity, order_reference, movement_status
  ) VALUES (
    v_movement_id, p_pallet_id, v_pallet.current_zone, p_to_zone,
    current_date, current_time, p_moved_by,
    NULLIF(trim(p_reason), ''), NULLIF(trim(p_override_reason), ''),
    v_qty, NULLIF(trim(p_order_reference), ''), 'In Transit'
  );

  UPDATE pallets SET
    in_transit_to_zone       = p_to_zone,
    in_transit_movement_id   = v_movement_id,
    in_transit_initiated_at  = now(),
    in_transit_initiated_by  = p_moved_by,
    notes = CASE
      WHEN trim(p_reason) != ''
        THEN COALESCE(notes || E'\n', '') || '[Initiate] ' || p_reason
      ELSE notes
    END
  WHERE pallet_id = p_pallet_id;

  -- Forklift assignment is mandatory — roll back move if none available
  v_fl_res := assign_forklift_to_movement(v_movement_id);
  IF COALESCE((v_fl_res->>'success')::boolean, false) = false THEN
    RAISE EXCEPTION 'No available forklift. Move cannot be initiated right now.';
  END IF;

  RETURN jsonb_build_object(
    'success',       true,
    'message',       'Move initiated to ' || p_to_zone,
    'movementId',    v_movement_id,
    'fromZone',      v_pallet.current_zone,
    'forklift_code', v_fl_res->>'forklift_code',
    'forklift_name', v_fl_res->>'forklift_name'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION movement_initiate(text, text, text, text, text, numeric, text) TO anon;
