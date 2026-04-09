-- ═══════════════════════════════════════════════════════════════════════════════
-- RetiFlux™ — Warehouse Traffic Center — Full Supabase Setup
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- PREREQUISITES (run first if not done):
--   1. Schema: RUN_IN_SQL_EDITOR.sql (creates pallets, zone_config, zone_transitions, zone_movements)
--   2. Seed:   RUN_SEED_ONLY.sql (zone_config + zone_transitions data)
--   3. Movement: RUN_MOVEMENT_SUPABASE.sql (movement_initiate, movement_receive, RLS)
--
-- This file adds:
--   • movement_auto_revert (15 min timeout)
--   • traffic_highway_counts (for highway thickness)
--   • traffic_avg_transit_seconds (for avg transit display)
--   • Optional pg_cron schedule
--
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Auto-revert (15 min transit timeout)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION movement_auto_revert()
RETURNS jsonb AS $$
DECLARE
  v_cutoff timestamptz;
  v_pallet pallets%ROWTYPE;
  v_reverted jsonb := '[]'::jsonb;
  v_count int := 0;
BEGIN
  v_cutoff := now() - interval '15 minutes';

  FOR v_pallet IN
    SELECT * FROM pallets
    WHERE in_transit_to_zone IS NOT NULL
      AND trim(in_transit_to_zone) != ''
      AND (in_transit_initiated_at IS NULL OR in_transit_initiated_at < v_cutoff)
  LOOP
    UPDATE pallets SET
      in_transit_to_zone = NULL,
      in_transit_movement_id = NULL,
      in_transit_initiated_at = NULL,
      in_transit_initiated_by = NULL,
      notes = CASE WHEN trim(COALESCE(notes, '')) != '' THEN notes || E'\n' ELSE '' END || '[Auto-Revert] In transit > 15 min - reverted to ' || v_pallet.current_zone
    WHERE pallet_id = v_pallet.pallet_id;

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
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reverted', v_count,
    'pallets', v_reverted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION movement_auto_revert() TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Traffic Center: highway counts (by time range)
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Traffic Center: avg transit time (configurable scope)
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Optional: pg_cron (Supabase Pro only)
-- Uncomment and run if pg_cron is enabled:
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT cron.schedule(
--   'retiflux-auto-revert',
--   '*/5 * * * *',
--   $$SELECT movement_auto_revert()$$
-- );
--
-- For free tier: use external cron (GitHub Actions, Vercel, etc.) to call
--   supabase.rpc('movement_auto_revert')
-- every 5 minutes.
