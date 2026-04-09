-- RetiFlux™ — Data consistency: single source of truth, no silent loss
-- Ensures pallets ↔ zone_movements stay in sync; trails reflect reality
-- Run after RUN_MOVEMENT_SUPABASE.sql and 009_pallet_trail.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Harden movement_receive: use in_transit_movement_id for precise update
--    Prevents updating wrong movement if multiple exist; fails if movement missing
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

  -- Update zone_movements FIRST (single source of truth for movement status)
  -- Use in_transit_movement_id when available for precision; fallback for legacy data
  IF v_pallet.in_transit_movement_id IS NOT NULL AND trim(v_pallet.in_transit_movement_id) != '' THEN
    UPDATE zone_movements SET
      movement_status = 'Received',
      received_at = now(),
      received_by = p_received_by
    WHERE movement_id = v_pallet.in_transit_movement_id AND movement_status = 'In Transit';
  ELSE
    UPDATE zone_movements SET
      movement_status = 'Received',
      received_at = now(),
      received_by = p_received_by
    WHERE pallet_id = p_pallet_id AND movement_status = 'In Transit';
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No matching In Transit movement for pallet. Pallet and zone_movements may be out of sync.'
    );
  END IF;

  -- Only update pallet after movement is confirmed updated
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
-- 2. Fix get_pallet_trail: infer creation zone from reality, not assumption
--    - If movements exist: first movement's from_zone = where pallet was created
--    - If no movements: current_zone = where pallet was created (e.g. sim direct insert)
--    Ensures trail matches actual data even when pallets bypass Receiving
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_pallet_trail(p_pallet_id text)
RETURNS jsonb AS $$
DECLARE
  v_pallet pallets%ROWTYPE;
  v_trail jsonb := '[]'::jsonb;
  v_created jsonb;
  v_mov jsonb;
  v_row record;
  v_creation_zone text;
BEGIN
  IF NULLIF(trim(p_pallet_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing pallet_id');
  END IF;

  SELECT * INTO v_pallet FROM pallets WHERE pallet_id = p_pallet_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet not found: ' || p_pallet_id);
  END IF;

  -- Infer creation zone: first movement's from_zone, or current_zone if no movements
  SELECT zm.from_zone INTO v_creation_zone
  FROM zone_movements zm
  WHERE zm.pallet_id = p_pallet_id
  ORDER BY zm.created_at ASC
  LIMIT 1;

  v_creation_zone := COALESCE(v_creation_zone, v_pallet.current_zone);

  -- 1. Creation event (birth: ticket → creation zone)
  v_created := jsonb_build_object(
    'seq', 1,
    'type', 'created',
    'zone', v_creation_zone,
    'label', 'Created from ticket → ' || v_creation_zone,
    'at', v_pallet.created_at,
    'by', COALESCE(v_pallet.created_by, v_pallet.original_ticket_serial),
    'order_ref', null,
    'movement_id', null,
    'status', null,
    'from_zone', null,
    'to_zone', v_creation_zone,
    'ticket_serial', v_pallet.original_ticket_serial
  );
  v_trail := v_trail || jsonb_build_array(v_created);

  -- 2. Zone movements (chronological)
  FOR v_row IN
    SELECT zm.movement_id, zm.from_zone, zm.to_zone, zm.moved_by, zm.received_by,
           zm.movement_status, zm.order_reference, zm.created_at, zm.received_at
    FROM zone_movements zm
    WHERE zm.pallet_id = p_pallet_id
    ORDER BY zm.created_at ASC
  LOOP
    v_mov := jsonb_build_object(
      'seq', jsonb_array_length(v_trail) + 1,
      'type', 'movement',
      'from_zone', v_row.from_zone,
      'to_zone', v_row.to_zone,
      'label', v_row.from_zone || ' → ' || v_row.to_zone,
      'at', COALESCE(v_row.received_at, v_row.created_at),
      'by', v_row.moved_by,
      'received_by', v_row.received_by,
      'order_ref', v_row.order_reference,
      'movement_id', v_row.movement_id,
      'status', v_row.movement_status,
      'zone', null
    );
    v_trail := v_trail || jsonb_build_array(v_mov);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'pallet_id', p_pallet_id,
    'sku', v_pallet.sku,
    'current_zone', v_pallet.current_zone,
    'in_transit_to', v_pallet.in_transit_to_zone,
    'status', v_pallet.status,
    'quantity', v_pallet.remaining_quantity,
    'original_ticket', v_pallet.original_ticket_serial,
    'trail', v_trail
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Consistency check function: detect pallet ↔ movement drift
--    Call periodically or after suspect operations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_movement_consistency()
RETURNS jsonb AS $$
DECLARE
  v_in_transit_no_mov jsonb;
  v_mov_no_pallet jsonb;
  v_mov_in_transit_pallet_cleared jsonb;
BEGIN
  -- Pallets marked in-transit but no matching In Transit movement
  SELECT jsonb_agg(jsonb_build_object('pallet_id', p.pallet_id, 'in_transit_to', p.in_transit_to_zone, 'in_transit_movement_id', p.in_transit_movement_id))
  INTO v_in_transit_no_mov
  FROM pallets p
  WHERE p.in_transit_to_zone IS NOT NULL AND trim(p.in_transit_to_zone) != ''
    AND NOT EXISTS (
      SELECT 1 FROM zone_movements zm
      WHERE zm.pallet_id = p.pallet_id AND zm.movement_status = 'In Transit'
        AND (p.in_transit_movement_id IS NULL OR zm.movement_id = p.in_transit_movement_id)
    );

  -- Movements In Transit for pallets that are not in transit
  SELECT jsonb_agg(jsonb_build_object('movement_id', zm.movement_id, 'pallet_id', zm.pallet_id))
  INTO v_mov_in_transit_pallet_cleared
  FROM zone_movements zm
  JOIN pallets p ON p.pallet_id = zm.pallet_id
  WHERE zm.movement_status = 'In Transit'
    AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '');

  -- Orphan movements (pallet deleted)
  SELECT jsonb_agg(jsonb_build_object('movement_id', zm.movement_id, 'pallet_id', zm.pallet_id))
  INTO v_mov_no_pallet
  FROM zone_movements zm
  WHERE NOT EXISTS (SELECT 1 FROM pallets p WHERE p.pallet_id = zm.pallet_id);

  RETURN jsonb_build_object(
    'ok', (v_in_transit_no_mov IS NULL OR v_in_transit_no_mov = '[]'::jsonb)
      AND (v_mov_in_transit_pallet_cleared IS NULL OR v_mov_in_transit_pallet_cleared = '[]'::jsonb)
      AND (v_mov_no_pallet IS NULL OR v_mov_no_pallet = '[]'::jsonb),
    'in_transit_no_movement', COALESCE(v_in_transit_no_mov, '[]'::jsonb),
    'movement_in_transit_pallet_cleared', COALESCE(v_mov_in_transit_pallet_cleared, '[]'::jsonb),
    'orphan_movements', COALESCE(v_mov_no_pallet, '[]'::jsonb)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION check_movement_consistency() TO anon;
