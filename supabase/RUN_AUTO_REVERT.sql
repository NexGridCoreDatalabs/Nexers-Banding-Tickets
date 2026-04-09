-- RetiFlux™ — Auto-revert in-transit pallets after 15 minutes
-- Run in Supabase SQL Editor (after RUN_MOVEMENT_SUPABASE.sql)
-- Call movement_auto_revert() via pg_cron (every 5 min) or external scheduler

-- 15 min total: initiate → must receive within 15 min, else auto-revert
CREATE OR REPLACE FUNCTION movement_auto_revert()
RETURNS jsonb AS $$
DECLARE
  v_cutoff timestamptz;
  v_pallet pallets%ROWTYPE;
  v_reverted jsonb := '[]'::jsonb;
BEGIN
  v_cutoff := now() - interval '15 minutes';

  FOR v_pallet IN
    SELECT * FROM pallets
    WHERE in_transit_to_zone IS NOT NULL
      AND in_transit_initiated_at IS NOT NULL
      AND in_transit_initiated_at < v_cutoff
  LOOP
    -- Clear in-transit on pallet (pallet stays at current_zone = origin)
    UPDATE pallets SET
      in_transit_to_zone = NULL,
      in_transit_movement_id = NULL,
      in_transit_initiated_at = NULL,
      in_transit_initiated_by = NULL
    WHERE pallet_id = v_pallet.pallet_id;

    -- Mark movement as auto-reverted
    UPDATE zone_movements SET
      movement_status = 'Auto-Reverted',
      auto_reverted_at = now()
    WHERE pallet_id = v_pallet.pallet_id
      AND movement_status = 'In Transit';

    v_reverted := v_reverted || jsonb_build_object(
      'palletId', v_pallet.pallet_id,
      'fromZone', v_pallet.current_zone,
      'toZone', v_pallet.in_transit_to_zone
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reverted', jsonb_array_length(v_reverted),
    'pallets', v_reverted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION movement_auto_revert() TO anon;

-- Optional: pg_cron schedule (if enabled in Supabase)
-- SELECT cron.schedule('auto-revert-transits', '*/5 * * * *', $$SELECT movement_auto_revert()$$);
