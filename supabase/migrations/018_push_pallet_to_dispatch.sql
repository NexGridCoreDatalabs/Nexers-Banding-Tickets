-- RetiFlux™ — Push single order pallet to dispatch
-- Migration 018: Zone clerk releases each pallet separately; this RPC pushes one pallet at a time.
-- Run after 015, 017.

CREATE OR REPLACE FUNCTION push_pallet_to_dispatch(p_pallet_id text, p_moved_by text DEFAULT 'System')
RETURNS jsonb AS $$
DECLARE
  v_order_ref text;
  v_res jsonb;
BEGIN
  IF NULLIF(trim(p_pallet_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing pallet_id');
  END IF;

  SELECT COALESCE(o.external_order_no, 'ORD-' || op.order_id::text) INTO v_order_ref
  FROM order_pallets op
  JOIN orders o ON o.id = op.order_id
  JOIN pallets p ON p.pallet_id = op.pallet_id
  WHERE op.pallet_id = p_pallet_id
    AND op.status = 'released'
    AND p.current_zone = 'SuperMarket Area'
    AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet not found, not released, or not in SuperMarket');
  END IF;

  BEGIN
    v_res := movement_initiate(
      p_pallet_id,
      'Dispatch Loading Area',
      COALESCE(NULLIF(trim(p_moved_by), ''), 'System'),
      'Push to dispatch: Order ' || v_order_ref,
      '', NULL, v_order_ref
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  IF NOT (v_res->>'success')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_res->>'error', 'Movement failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'pallet_id', p_pallet_id, 'message', 'Pallet ' || p_pallet_id || ' pushed to Dispatch');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION push_pallet_to_dispatch(text, text) TO anon;
