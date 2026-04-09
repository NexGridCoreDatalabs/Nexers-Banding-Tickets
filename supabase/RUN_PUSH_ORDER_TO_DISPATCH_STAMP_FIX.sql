-- RetiFlux™ — Fix push_order_to_dispatch stamps when no pallets moved
-- This prevents "pushed_to_dispatch_at" from blocking future pushes/zone-clerk release
-- when the UI called push too early (0 eligible pallets).

CREATE OR REPLACE FUNCTION push_order_to_dispatch_uuid(p_order_id uuid, p_moved_by text DEFAULT 'System')
RETURNS jsonb AS $$
DECLARE v_line record; v_pallet record; v_op record; v_qty_needed numeric; v_qty_allocated numeric;
  v_pallets_moved text[] := '{}'; v_res jsonb; v_order_ref text; v_pushed_at timestamptz;
  v_uses_order_pallets boolean := false; v_in_progress_count int;
BEGIN
  IF p_order_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Missing order_id'); END IF;
  SELECT external_order_no, pushed_to_dispatch_at INTO v_order_ref, v_pushed_at FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order not found'); END IF;
  IF v_pushed_at IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Order already pushed to dispatch'); END IF;

  IF NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = p_order_id AND o.status IN ('AWAITING_SM_RELEASE', 'COMPLETED')) AND
     COALESCE((SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = p_order_id AND ol.status IN ('PICKED','SHORT')) * 100 / NULLIF((SELECT total_lines FROM orders WHERE id = p_order_id), 0), 0) < 75 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order must be 75%+ picked or submitted for release (AWAITING_SM_RELEASE)');
  END IF;

  v_order_ref := COALESCE(v_order_ref, 'ORD-' || p_order_id::text);

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_pallets') THEN
    v_uses_order_pallets := EXISTS (SELECT 1 FROM order_pallets WHERE order_id = p_order_id);
  END IF;

  IF v_uses_order_pallets THEN
    SELECT COUNT(*) INTO v_in_progress_count FROM order_pallets WHERE order_id = p_order_id AND status = 'in_progress';
    IF v_in_progress_count > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot push: ' || v_in_progress_count || ' pallet(s) still in progress.');
    END IF;
  END IF;

  IF v_uses_order_pallets THEN
    FOR v_op IN
      SELECT op.pallet_id
      FROM order_pallets op JOIN pallets p ON p.pallet_id = op.pallet_id
      WHERE op.order_id = p_order_id AND op.status = 'released' AND p.current_zone = 'SuperMarket Area'
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '') ORDER BY op.sequence
    LOOP
      BEGIN
        v_res := movement_initiate(
          v_op.pallet_id,
          'Dispatch Loading Area',
          COALESCE(NULLIF(trim(p_moved_by), ''), 'System'),
          'Push to dispatch: Order ' || v_order_ref,
          '',
          NULL,
          v_order_ref
        );
        IF (v_res->>'success')::boolean THEN v_pallets_moved := v_pallets_moved || v_op.pallet_id; END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END LOOP;
  ELSE
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
          AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '') AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        ORDER BY p.created_at ASC
      LOOP
        EXIT WHEN v_qty_needed <= 0;
        v_qty_allocated := LEAST(v_qty_needed, COALESCE(v_pallet.remaining_quantity, v_pallet.quantity, 0));
        IF v_qty_allocated <= 0 THEN CONTINUE; END IF;
        BEGIN
          v_res := movement_initiate(
            v_pallet.pallet_id,
            'Dispatch Loading Area',
            COALESCE(NULLIF(trim(p_moved_by), ''), 'System'),
            'Push to dispatch: Order ' || v_order_ref,
            '',
            NULL,
            v_order_ref
          );
          IF (v_res->>'success')::boolean THEN v_pallets_moved := v_pallets_moved || v_pallet.pallet_id; END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_qty_needed := v_qty_needed - v_qty_allocated;
      END LOOP;
    END LOOP;
  END IF;

  -- Only stamp pushed_to_dispatch_at when we actually moved pallets.
  IF COALESCE(array_length(v_pallets_moved, 1), 0) > 0 THEN
    UPDATE orders
    SET pushed_to_dispatch_at = now(),
        pushed_to_dispatch_by = NULLIF(trim(p_moved_by), '')
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'pallets_moved', COALESCE(array_length(v_pallets_moved, 1), 0),
    'pallet_ids', v_pallets_moved,
    'message', CASE
      WHEN COALESCE(array_length(v_pallets_moved, 1), 0) > 0 THEN 'Order pushed'
      ELSE 'No eligible pallets to push yet; not marking pushed_to_dispatch_at'
    END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION push_order_to_dispatch(p_order_id text, p_moved_by text DEFAULT 'System')
RETURNS jsonb AS $$
DECLARE v_order_id uuid;
BEGIN
  IF p_order_id IS NULL OR trim(p_order_id) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'Missing order_id'); END IF;
  BEGIN
    v_order_id := p_order_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_order_id FROM orders WHERE external_order_no = p_order_id LIMIT 1;
    IF NOT FOUND THEN
      SELECT order_id INTO v_order_id FROM order_pallets WHERE pallet_id = p_order_id LIMIT 1;
      IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order not found: ' || p_order_id); END IF;
    END IF;
  END;
  RETURN push_order_to_dispatch_uuid(v_order_id, COALESCE(p_moved_by, 'System'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';

