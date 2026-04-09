-- RetiFlux™ — Pallet trail: full history from creation to current
-- Ticket → Receiving → zone movements → current zone
-- Returns JSON for UI display on hover in traffic center

CREATE OR REPLACE FUNCTION get_pallet_trail(p_pallet_id text)
RETURNS jsonb AS $$
DECLARE
  v_pallet pallets%ROWTYPE;
  v_trail jsonb := '[]'::jsonb;
  v_created jsonb;
  v_mov jsonb;
  v_row record;
BEGIN
  IF NULLIF(trim(p_pallet_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing pallet_id');
  END IF;

  SELECT * INTO v_pallet FROM pallets WHERE pallet_id = p_pallet_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet not found: ' || p_pallet_id);
  END IF;

  -- 1. Creation event (birth: ticket → Receiving Area)
  v_created := jsonb_build_object(
    'seq', 1,
    'type', 'created',
    'zone', 'Receiving Area',
    'label', 'Created from ticket → Receiving Area',
    'at', v_pallet.created_at,
    'by', COALESCE(v_pallet.created_by, v_pallet.original_ticket_serial),
    'order_ref', null,
    'movement_id', null,
    'status', null,
    'from_zone', null,
    'to_zone', 'Receiving Area',
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

GRANT EXECUTE ON FUNCTION get_pallet_trail(text) TO anon;
