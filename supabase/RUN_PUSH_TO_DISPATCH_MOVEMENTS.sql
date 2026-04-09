-- RetiFlux™ — Push to dispatch: real movements + auto-arrival at Dispatch
-- Run in Supabase SQL Editor
-- Prerequisite: orders table must have pushed_to_dispatch_at column

ALTER TABLE orders ADD COLUMN IF NOT EXISTS pushed_to_dispatch_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pushed_to_dispatch_by text;

-- 1. push_order_to_dispatch(order_id, moved_by) — initiates pallet movements SM → Dispatch
-- 2. movement_auto_receive_dispatch(minutes) — auto-receive at Dispatch after 7–10 min (default 8)
-- 3. movement_auto_revert — now excludes Dispatch-bound pallets

CREATE OR REPLACE FUNCTION push_order_to_dispatch(p_order_id uuid, p_moved_by text DEFAULT 'System')
RETURNS jsonb AS $$
DECLARE
  v_line record;
  v_pallet record;
  v_op record;
  v_qty_needed numeric;
  v_qty_allocated numeric;
  v_pallets_moved text[] := '{}';
  v_res jsonb;
  v_order_ref text;
  v_pushed_at timestamptz;
  v_uses_order_pallets boolean := false;
BEGIN
  IF p_order_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Missing order_id'); END IF;
  SELECT external_order_no, pushed_to_dispatch_at INTO v_order_ref, v_pushed_at
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order not found'); END IF;
  IF v_pushed_at IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Order already pushed to dispatch'); END IF;
  -- 75% rule: order must be AWAITING_SM_RELEASE (picker submitted) or 75%+ lines picked
  IF NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = p_order_id AND o.status IN ('AWAITING_SM_RELEASE', 'COMPLETED')) AND
     COALESCE((SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = p_order_id AND ol.status IN ('PICKED','SHORT')) * 100 / NULLIF((SELECT total_lines FROM orders WHERE id = p_order_id), 0), 0) < 75 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order must be 75%+ picked or submitted for release (AWAITING_SM_RELEASE)');
  END IF;
  v_order_ref := COALESCE(v_order_ref, 'ORD-' || p_order_id::text);

  -- If order has order_pallets, ONLY move released child pallets (never fall back to legacy)
  -- Order pallets have sku='MIXED' and would not match legacy SKU lookup
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_pallets') THEN
    v_uses_order_pallets := EXISTS (SELECT 1 FROM order_pallets WHERE order_id = p_order_id);
  END IF;

  IF v_uses_order_pallets THEN
    -- Move only linked child pallets (exact quantities, no over-move)
    FOR v_op IN
      SELECT op.pallet_id
      FROM order_pallets op
      JOIN pallets p ON p.pallet_id = op.pallet_id
      WHERE op.order_id = p_order_id AND op.status = 'released'
        AND p.current_zone = 'SuperMarket Area'
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
      ORDER BY op.sequence
    LOOP
      BEGIN
        v_res := movement_initiate(v_op.pallet_id, 'Dispatch Loading Area', COALESCE(NULLIF(trim(p_moved_by), ''), 'System'), 'Push to dispatch: Order ' || v_order_ref, '', NULL, v_order_ref);
        IF (v_res->>'success')::boolean THEN v_pallets_moved := v_pallets_moved || v_op.pallet_id; END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END LOOP;
  ELSE
    -- Legacy: infer pallets from order lines (can over-move)
    FOR v_line IN
      SELECT ol.item_code, SUM(ol.quantity) AS quantity
      FROM order_lines ol
      WHERE ol.order_id = p_order_id AND ol.status = 'PICKED' AND ol.item_code IS NOT NULL
      GROUP BY ol.item_code
    LOOP
      v_qty_needed := COALESCE(v_line.quantity, 0);
      IF v_qty_needed <= 0 THEN CONTINUE; END IF;
      FOR v_pallet IN
        SELECT p.pallet_id, p.remaining_quantity, p.quantity
        FROM pallets p
        WHERE p.current_zone = 'SuperMarket Area' AND p.sku = v_line.item_code
          AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
          AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        ORDER BY p.created_at ASC
      LOOP
        EXIT WHEN v_qty_needed <= 0;
        v_qty_allocated := LEAST(v_qty_needed, COALESCE(v_pallet.remaining_quantity, v_pallet.quantity, 0));
        IF v_qty_allocated <= 0 THEN CONTINUE; END IF;
        BEGIN
          v_res := movement_initiate(v_pallet.pallet_id, 'Dispatch Loading Area', COALESCE(NULLIF(trim(p_moved_by), ''), 'System'), 'Push to dispatch: Order ' || v_order_ref, '', NULL, v_order_ref);
          IF (v_res->>'success')::boolean THEN v_pallets_moved := v_pallets_moved || v_pallet.pallet_id; END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_qty_needed := v_qty_needed - v_qty_allocated;
      END LOOP;
    END LOOP;
  END IF;

  UPDATE orders SET pushed_to_dispatch_at = now(), pushed_to_dispatch_by = NULLIF(trim(p_moved_by), '') WHERE id = p_order_id;
  RETURN jsonb_build_object('success', true, 'pallets_moved', COALESCE(array_length(v_pallets_moved, 1), 0), 'pallet_ids', v_pallets_moved, 'message', 'Order pushed: ' || COALESCE(array_length(v_pallets_moved, 1), 0) || ' pallet(s) to Dispatch');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION movement_auto_receive_dispatch(p_minutes int DEFAULT 8)
RETURNS jsonb AS $$
DECLARE v_cutoff timestamptz; v_pallet pallets%ROWTYPE; v_received jsonb := '[]'::jsonb; v_count int := 0; v_min int;
BEGIN
  v_min := GREATEST(7, LEAST(10, COALESCE(p_minutes, 8)));
  v_cutoff := now() - (v_min || ' minutes')::interval;
  FOR v_pallet IN SELECT * FROM pallets WHERE in_transit_to_zone = 'Dispatch Loading Area' AND in_transit_initiated_at IS NOT NULL AND in_transit_initiated_at < v_cutoff
  LOOP
    PERFORM movement_receive(v_pallet.pallet_id, 'Auto-arrival');
    v_received := v_received || jsonb_build_object('palletId', v_pallet.pallet_id, 'fromZone', v_pallet.current_zone, 'toZone', 'Dispatch Loading Area');
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'received', v_count, 'pallets', v_received);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION movement_auto_revert()
RETURNS jsonb AS $$
DECLARE v_cutoff timestamptz; v_pallet pallets%ROWTYPE; v_reverted jsonb := '[]'::jsonb; v_count int := 0;
BEGIN
  v_cutoff := now() - interval '15 minutes';
  FOR v_pallet IN SELECT * FROM pallets WHERE in_transit_to_zone IS NOT NULL AND trim(in_transit_to_zone) != '' AND in_transit_to_zone != 'Dispatch Loading Area' AND (in_transit_initiated_at IS NULL OR in_transit_initiated_at < v_cutoff)
  LOOP
    UPDATE pallets SET in_transit_to_zone = NULL, in_transit_movement_id = NULL, in_transit_initiated_at = NULL, in_transit_initiated_by = NULL, notes = CASE WHEN trim(COALESCE(notes, '')) != '' THEN notes || E'\n' ELSE '' END || '[Auto-Revert] In transit > 15 min' WHERE pallet_id = v_pallet.pallet_id;
    UPDATE zone_movements SET movement_status = 'Auto-Reverted', auto_reverted_at = now() WHERE pallet_id = v_pallet.pallet_id AND movement_status = 'In Transit';
    v_reverted := v_reverted || jsonb_build_object('palletId', v_pallet.pallet_id, 'fromZone', v_pallet.current_zone, 'toZone', v_pallet.in_transit_to_zone);
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'reverted', v_count, 'pallets', v_reverted);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION push_order_to_dispatch(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION movement_auto_receive_dispatch(int) TO anon;
