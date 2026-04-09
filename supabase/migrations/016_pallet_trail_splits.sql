-- RetiFlux™ — Extend pallet trail with splits (parent-sharing across orders)
-- Migration 016: Run after 014, 015
-- Adds splits_for_parent and splits_from_parents to trail response

CREATE OR REPLACE FUNCTION get_pallet_trail(p_pallet_id text)
RETURNS jsonb AS $$
DECLARE
  v_pallet pallets%ROWTYPE;
  v_trail jsonb := '[]'::jsonb;
  v_created jsonb;
  v_mov jsonb;
  v_row record;
  v_creation_zone text;
  v_splits_out jsonb := '[]'::jsonb;
  v_splits_in jsonb := '[]'::jsonb;
  v_split record;
BEGIN
  IF NULLIF(trim(p_pallet_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing pallet_id');
  END IF;

  SELECT * INTO v_pallet FROM pallets WHERE pallet_id = p_pallet_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet not found: ' || p_pallet_id);
  END IF;

  SELECT zm.from_zone INTO v_creation_zone
  FROM zone_movements zm WHERE zm.pallet_id = p_pallet_id ORDER BY zm.created_at ASC LIMIT 1;
  v_creation_zone := COALESCE(v_creation_zone, v_pallet.current_zone);

  v_created := jsonb_build_object(
    'seq', 1, 'type', 'created', 'zone', v_creation_zone,
    'label', 'Created from ticket → ' || v_creation_zone,
    'at', v_pallet.created_at, 'by', COALESCE(v_pallet.created_by, v_pallet.original_ticket_serial),
    'order_ref', null, 'movement_id', null, 'status', null, 'from_zone', null, 'to_zone', v_creation_zone,
    'ticket_serial', v_pallet.original_ticket_serial
  );
  v_trail := v_trail || jsonb_build_array(v_created);

  FOR v_row IN
    SELECT zm.movement_id, zm.from_zone, zm.to_zone, zm.moved_by, zm.received_by,
           zm.movement_status, zm.order_reference, zm.created_at, zm.received_at
    FROM zone_movements zm WHERE zm.pallet_id = p_pallet_id ORDER BY zm.created_at ASC
  LOOP
    v_mov := jsonb_build_object(
      'seq', jsonb_array_length(v_trail) + 1, 'type', 'movement',
      'from_zone', v_row.from_zone, 'to_zone', v_row.to_zone,
      'label', v_row.from_zone || ' → ' || v_row.to_zone,
      'at', COALESCE(v_row.received_at, v_row.created_at), 'by', v_row.moved_by,
      'received_by', v_row.received_by, 'order_ref', v_row.order_reference,
      'movement_id', v_row.movement_id, 'status', v_row.movement_status, 'zone', null
    );
    v_trail := v_trail || jsonb_build_array(v_mov);
  END LOOP;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pallet_splits') THEN
    FOR v_split IN
      SELECT ps.child_pallet_id, ps.order_id, ps.sku, ps.quantity, ps.created_at, o.external_order_no
      FROM pallet_splits ps LEFT JOIN orders o ON o.id = ps.order_id
      WHERE ps.parent_pallet_id = p_pallet_id ORDER BY ps.created_at ASC
    LOOP
      v_splits_out := v_splits_out || jsonb_build_object(
        'child_pallet_id', v_split.child_pallet_id, 'order_id', v_split.order_id,
        'order_ref', COALESCE(v_split.external_order_no, 'ORD-' || v_split.order_id::text),
        'sku', v_split.sku, 'quantity', v_split.quantity, 'at', v_split.created_at
      );
    END LOOP;
    FOR v_split IN
      SELECT ps.parent_pallet_id, ps.order_id, ps.sku, ps.quantity, ps.created_at, o.external_order_no
      FROM pallet_splits ps LEFT JOIN orders o ON o.id = ps.order_id
      WHERE ps.child_pallet_id = p_pallet_id ORDER BY ps.created_at ASC
    LOOP
      v_splits_in := v_splits_in || jsonb_build_object(
        'parent_pallet_id', v_split.parent_pallet_id, 'order_id', v_split.order_id,
        'order_ref', COALESCE(v_split.external_order_no, 'ORD-' || v_split.order_id::text),
        'sku', v_split.sku, 'quantity', v_split.quantity, 'at', v_split.created_at
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'pallet_id', p_pallet_id, 'sku', v_pallet.sku,
    'current_zone', v_pallet.current_zone, 'in_transit_to', v_pallet.in_transit_to_zone,
    'status', v_pallet.status, 'quantity', v_pallet.remaining_quantity,
    'original_ticket', v_pallet.original_ticket_serial, 'trail', v_trail,
    'splits_for_parent', v_splits_out, 'splits_from_parents', v_splits_in
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_pallet_trail(text) TO anon;
