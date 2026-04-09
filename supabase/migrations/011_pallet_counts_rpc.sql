-- RetiFlux™ — Pallet counts by zone (no row limit)
-- Fixes highway showing 0 for SuperMarket when it has 400+ pallets
-- Supabase defaults to 1000 rows; this RPC does COUNT on the server

CREATE OR REPLACE FUNCTION get_pallet_counts_by_zone()
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_object_agg(COALESCE(current_zone, ''), cnt)
  INTO v_result
  FROM (
    SELECT current_zone, COUNT(*)::bigint AS cnt
    FROM pallets
    WHERE (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
    GROUP BY current_zone
  ) t;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_pallet_counts_by_zone() TO anon;
