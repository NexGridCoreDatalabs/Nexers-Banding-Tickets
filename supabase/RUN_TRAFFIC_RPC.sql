-- RetiFlux™ — Traffic Center RPCs
-- Run in Supabase SQL Editor (after RUN_MOVEMENT_SUPABASE.sql)

-- Highway counts: movements per (from_zone, to_zone) in time window
CREATE OR REPLACE FUNCTION traffic_highway_counts(p_interval text DEFAULT '24 hours')
RETURNS TABLE(from_zone text, to_zone text, cnt bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT zm.from_zone::text, zm.to_zone::text, COUNT(*)::bigint
  FROM zone_movements zm
  WHERE zm.created_at >= now() - (p_interval::interval)
  GROUP BY zm.from_zone, zm.to_zone
  ORDER BY cnt DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Avg transit time (initiate → receive) in seconds, for scope
CREATE OR REPLACE FUNCTION traffic_avg_transit_seconds(p_interval text DEFAULT '7 days')
RETURNS numeric AS $$
DECLARE
  v_avg numeric;
BEGIN
  SELECT AVG(EXTRACT(EPOCH FROM (received_at - created_at))) INTO v_avg
  FROM zone_movements
  WHERE received_at IS NOT NULL
    AND created_at >= now() - (p_interval::interval);
  RETURN COALESCE(v_avg, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION traffic_highway_counts(text) TO anon;
GRANT EXECUTE ON FUNCTION traffic_avg_transit_seconds(text) TO anon;
