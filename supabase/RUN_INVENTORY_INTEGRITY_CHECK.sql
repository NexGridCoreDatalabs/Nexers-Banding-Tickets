-- RetiFlux™ — Inventory integrity reconciliation
-- Goal: detect "loss" between Receiving and the rest of the system (including in-transit and Outbonded)
-- Usage:
--   SELECT check_pallet_and_qty_conservation('Receiving Area');
--   SELECT check_movement_drift();

-- 1) Movement drift detection (pallets ↔ zone_movements)
--    - pallets claiming "in transit" but no corresponding zone_movements row
--    - zone_movements "In Transit" without pallet matching in_transit_to_zone
--    - orphan zone_movements without pallets row
CREATE OR REPLACE FUNCTION check_movement_drift()
RETURNS jsonb AS $$
DECLARE
  v_in_transit_no_mov jsonb;
  v_mov_in_transit_pallet_cleared jsonb;
  v_orphan_movements jsonb;
BEGIN
  SELECT jsonb_agg(
           jsonb_build_object(
             'pallet_id', p.pallet_id,
             'in_transit_to', p.in_transit_to_zone,
             'in_transit_movement_id', p.in_transit_movement_id
           )
         )
    INTO v_in_transit_no_mov
  FROM pallets p
  WHERE p.in_transit_to_zone IS NOT NULL
    AND trim(p.in_transit_to_zone) != ''
    AND NOT EXISTS (
      SELECT 1
      FROM zone_movements zm
      WHERE zm.pallet_id = p.pallet_id
        AND zm.movement_status = 'In Transit'
        AND (p.in_transit_movement_id IS NULL OR zm.movement_id = p.in_transit_movement_id)
    );

  SELECT jsonb_agg(
           jsonb_build_object(
             'movement_id', zm.movement_id,
             'pallet_id', zm.pallet_id,
             'to_zone', zm.to_zone
           )
         )
    INTO v_mov_in_transit_pallet_cleared
  FROM zone_movements zm
  JOIN pallets p ON p.pallet_id = zm.pallet_id
  WHERE zm.movement_status = 'In Transit'
    AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '');

  SELECT jsonb_agg(
           jsonb_build_object(
             'movement_id', zm.movement_id,
             'pallet_id', zm.pallet_id,
             'movement_status', zm.movement_status,
             'from_zone', zm.from_zone,
             'to_zone', zm.to_zone
           )
         )
    INTO v_orphan_movements
  FROM zone_movements zm
  WHERE NOT EXISTS (SELECT 1 FROM pallets p WHERE p.pallet_id = zm.pallet_id);

  RETURN jsonb_build_object(
    'ok',
      COALESCE(v_in_transit_no_mov, '[]'::jsonb) = '[]'::jsonb
      AND COALESCE(v_mov_in_transit_pallet_cleared, '[]'::jsonb) = '[]'::jsonb
      AND COALESCE(v_orphan_movements, '[]'::jsonb) = '[]'::jsonb,
    'in_transit_no_movement', COALESCE(v_in_transit_no_mov, '[]'::jsonb),
    'movement_in_transit_pallet_cleared', COALESCE(v_mov_in_transit_pallet_cleared, '[]'::jsonb),
    'orphan_movements', COALESCE(v_orphan_movements, '[]'::jsonb)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION check_movement_drift() TO anon;

-- 2) Receiving ↔ others conservation (counts + qty), including in-transit pallets
-- "UI loss" often happens because existing count/stock helpers exclude in-transit pallets.
CREATE OR REPLACE FUNCTION check_pallet_and_qty_conservation(
  p_receiving_zone text DEFAULT 'Receiving Area'
)
RETURNS jsonb AS $$
DECLARE
  v_total_pallets bigint;
  v_total_qty numeric;

  v_receiving_pallets_excl_transit bigint;
  v_receiving_qty_excl_transit numeric;

  v_other_effective_pallets bigint;
  v_other_effective_qty numeric;

  v_other_ui_excl_transit_pallets bigint;
  v_other_ui_excl_transit_qty numeric;

  v_missing_transit_pallets bigint;
  v_missing_transit_qty numeric;
BEGIN
  SELECT
    COUNT(*)::bigint,
    COALESCE(SUM(COALESCE(remaining_quantity, 0)), 0)
  INTO v_total_pallets, v_total_qty
  FROM pallets;

  -- "UI-style" (existing helpers): counts only pallets where in_transit_to_zone is NULL/blank
  SELECT COUNT(*)::bigint,
         COALESCE(SUM(COALESCE(remaining_quantity, 0)), 0)
  INTO v_receiving_pallets_excl_transit, v_receiving_qty_excl_transit
  FROM pallets
  WHERE (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
    AND current_zone = p_receiving_zone;

  -- Requirement: including pallets moving (in_transit_to_zone belongs to a target zone)
  -- Effective zone = destination if in transit, otherwise current_zone
  SELECT COUNT(*)::bigint,
         COALESCE(SUM(COALESCE(remaining_quantity, 0)), 0)
  INTO v_other_effective_pallets, v_other_effective_qty
  FROM pallets
  WHERE COALESCE(NULLIF(trim(in_transit_to_zone), ''), current_zone) != p_receiving_zone;

  -- UI-style elsewhere (excluding in-transit)
  SELECT COUNT(*)::bigint,
         COALESCE(SUM(COALESCE(remaining_quantity, 0)), 0)
  INTO v_other_ui_excl_transit_pallets, v_other_ui_excl_transit_qty
  FROM pallets
  WHERE (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
    AND current_zone != p_receiving_zone;

  -- Missing = in-transit pallets destined to non-receiving zones
  SELECT COUNT(*)::bigint,
         COALESCE(SUM(COALESCE(remaining_quantity, 0)), 0)
  INTO v_missing_transit_pallets, v_missing_transit_qty
  FROM pallets
  WHERE in_transit_to_zone IS NOT NULL
    AND trim(in_transit_to_zone) != ''
    AND in_transit_to_zone != p_receiving_zone;

  RETURN jsonb_build_object(
    'receiving_zone', p_receiving_zone,
    'total_pallets_all_states', v_total_pallets,
    'total_qty_all_states', v_total_qty,

    'receiving_pallets_excluding_in_transit', v_receiving_pallets_excl_transit,
    'receiving_qty_excluding_in_transit', v_receiving_qty_excl_transit,

    'other_effective_pallets_including_in_transit', v_other_effective_pallets,
    'other_effective_qty_including_in_transit', v_other_effective_qty,

    'other_ui_excluding_in_transit', v_other_ui_excl_transit_pallets,
    'other_ui_qty_excluding_in_transit', v_other_ui_excl_transit_qty,

    'missing_due_to_transit_exclusion', v_missing_transit_pallets,
    'missing_qty_due_to_transit_exclusion', v_missing_transit_qty,

    -- sanity: UI-style missing should equal requirement minus UI-style elsewhere
    'conservation_check_pallets',
      (v_other_effective_pallets = (v_other_ui_excl_transit_pallets + v_missing_transit_pallets)),
    'conservation_check_qty',
      (v_other_effective_qty = (v_other_ui_excl_transit_qty + v_missing_transit_qty))
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION check_pallet_and_qty_conservation(text) TO anon;

