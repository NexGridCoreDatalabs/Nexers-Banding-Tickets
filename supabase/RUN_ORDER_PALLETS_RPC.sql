-- RetiFlux™ — Order pallets RPCs
-- Run in Supabase SQL Editor (after migration 014)
-- create_order_pallet, pick_to_order_pallet, complete_order_pallet

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. create_order_pallet(p_order_id, p_created_by) — creates child pallet in SM, returns pallet_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_order_pallet(p_order_id uuid, p_created_by text DEFAULT '')
RETURNS jsonb AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_next int;
  v_pallet_id text;
  v_seq int;
BEGIN
  IF p_order_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Missing order_id'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order not found'); END IF;

  -- Get and increment next_order_pallet_number for SuperMarket Area
  SELECT next_order_pallet_number INTO v_next FROM zone_config WHERE zone_name = 'SuperMarket Area';
  v_next := COALESCE(v_next, 1);
  UPDATE zone_config SET next_order_pallet_number = v_next + 1 WHERE zone_name = 'SuperMarket Area';

  v_pallet_id := 'SM-ORD-' || LPAD(v_next::text, 5, '0');

  -- Ensure unique (collision unlikely)
  IF EXISTS (SELECT 1 FROM pallets WHERE pallet_id = v_pallet_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet ID collision: ' || v_pallet_id);
  END IF;

  -- Get next sequence for this order
  SELECT COALESCE(MAX(sequence), 0) + 1 INTO v_seq FROM order_pallets WHERE order_id = p_order_id;

  -- Create pallet (order pallet: multi-SKU, placeholder sku)
  INSERT INTO pallets (pallet_id, pallet_type, current_zone, zone_prefix, sku, quantity, remaining_quantity, status, created_by)
  VALUES (v_pallet_id, 'Order', 'SuperMarket Area', 'SM', 'MIXED', 0, 0, 'Active', NULLIF(trim(p_created_by), ''));

  -- Link to order
  INSERT INTO order_pallets (order_id, pallet_id, sequence, status, created_by)
  VALUES (p_order_id, v_pallet_id, v_seq, 'in_progress', NULLIF(trim(p_created_by), ''));

  RETURN jsonb_build_object(
    'success', true,
    'pallet_id', v_pallet_id,
    'sequence', v_seq,
    'order_ref', COALESCE(v_order.external_order_no, 'ORD-' || p_order_id::text)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. pick_to_order_pallet(p_order_id, p_pallet_id, p_order_line_id, p_source_pallet_id, p_quantity, p_created_by)
--    When picker marks PICKED: split from parent, add to child, reduce parent remaining_quantity
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pick_to_order_pallet(
  p_order_id uuid,
  p_pallet_id text,
  p_order_line_id uuid,
  p_source_pallet_id text,
  p_quantity numeric,
  p_created_by text DEFAULT ''
)
RETURNS jsonb AS $$
DECLARE
  v_source pallets%ROWTYPE;
  v_child pallets%ROWTYPE;
  v_op order_pallets%ROWTYPE;
  v_avail numeric;
BEGIN
  IF p_order_id IS NULL OR NULLIF(trim(p_pallet_id), '') IS NULL OR NULLIF(trim(p_source_pallet_id), '') IS NULL OR NULLIF(p_quantity, 0) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing required params');
  END IF;

  SELECT * INTO v_source FROM pallets WHERE pallet_id = p_source_pallet_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Source pallet not found: ' || p_source_pallet_id); END IF;

  SELECT * INTO v_child FROM pallets WHERE pallet_id = p_pallet_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order pallet not found: ' || p_pallet_id); END IF;

  SELECT * INTO v_op FROM order_pallets WHERE order_id = p_order_id AND pallet_id = p_pallet_id AND status = 'in_progress';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order pallet not in progress or not linked to order'); END IF;

  v_avail := COALESCE(v_source.remaining_quantity, v_source.quantity, 0);
  IF p_quantity > v_avail THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source pallet has only ' || v_avail || ' available; requested ' || p_quantity);
  END IF;

  -- Record split (trail)
  INSERT INTO pallet_splits (parent_pallet_id, child_pallet_id, order_id, order_line_id, sku, quantity, created_by)
  VALUES (p_source_pallet_id, p_pallet_id, p_order_id, p_order_line_id, v_source.sku, p_quantity, NULLIF(trim(p_created_by), ''));

  -- Add to pallet_contents (upsert by pallet_id + sku)
  INSERT INTO pallet_contents (pallet_id, sku, quantity, source_pallet_id)
  VALUES (p_pallet_id, v_source.sku, p_quantity, p_source_pallet_id)
  ON CONFLICT (pallet_id, sku) DO UPDATE SET quantity = pallet_contents.quantity + EXCLUDED.quantity;

  UPDATE pallets SET remaining_quantity = remaining_quantity - p_quantity WHERE pallet_id = p_source_pallet_id;

  -- Update child pallet quantity (sum of contents)
  UPDATE pallets p SET
    quantity = (SELECT COALESCE(SUM(quantity), 0) FROM pallet_contents WHERE pallet_id = p.pallet_id),
    remaining_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM pallet_contents WHERE pallet_id = p.pallet_id)
  WHERE pallet_id = p_pallet_id;

  RETURN jsonb_build_object('success', true, 'message', 'Picked ' || p_quantity || ' from ' || p_source_pallet_id || ' to ' || p_pallet_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. complete_order_pallet(p_order_id, p_pallet_id, p_completed_by)
--    Picker marks pallet full → status = complete for zone clerk to release
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION complete_order_pallet(p_order_id uuid, p_pallet_id text, p_completed_by text DEFAULT '')
RETURNS jsonb AS $$
DECLARE
  v_op order_pallets%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR NULLIF(trim(p_pallet_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order_id or pallet_id');
  END IF;

  SELECT * INTO v_op FROM order_pallets WHERE order_id = p_order_id AND pallet_id = p_pallet_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order pallet not found'); END IF;
  IF v_op.status = 'complete' THEN RETURN jsonb_build_object('success', false, 'error', 'Pallet already complete'); END IF;

  UPDATE order_pallets SET status = 'complete', completed_at = now(), completed_by = NULLIF(trim(p_completed_by), '')
  WHERE order_id = p_order_id AND pallet_id = p_pallet_id;

  RETURN jsonb_build_object('success', true, 'message', 'Pallet ' || p_pallet_id || ' marked complete for zone clerk release');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. release_order_pallet(p_order_id, p_pallet_id, p_released_by)
--    Zone clerk releases pallet (status = released) — ready for push to dispatch
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_order_pallet(p_order_id uuid, p_pallet_id text, p_released_by text DEFAULT '')
RETURNS jsonb AS $$
DECLARE
  v_op order_pallets%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR NULLIF(trim(p_pallet_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order_id or pallet_id');
  END IF;

  SELECT * INTO v_op FROM order_pallets WHERE order_id = p_order_id AND pallet_id = p_pallet_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order pallet not found'); END IF;
  IF v_op.status != 'complete' THEN RETURN jsonb_build_object('success', false, 'error', 'Pallet must be complete before release'); END IF;

  UPDATE order_pallets SET status = 'released'
  WHERE order_id = p_order_id AND pallet_id = p_pallet_id;

  RETURN jsonb_build_object('success', true, 'message', 'Pallet ' || p_pallet_id || ' released');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_order_pallet(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION pick_to_order_pallet(uuid, text, uuid, text, numeric, text) TO anon;
GRANT EXECUTE ON FUNCTION complete_order_pallet(uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION release_order_pallet(uuid, text, text) TO anon;
