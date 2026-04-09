-- RetiFlux™ — Verify + repair zone_config.current_occupancy
-- Purpose:
--   Compare zone_config.current_occupancy against actual pallets table counts
--   and sync all zones to true counts.
--
-- Run in Supabase SQL Editor.

-- 1) Show mismatch report BEFORE fix
WITH actual AS (
  SELECT
    current_zone AS zone_name,
    COUNT(*)::int AS actual_occupancy
  FROM pallets
  WHERE in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = ''
  GROUP BY current_zone
)
SELECT
  z.zone_name,
  z.current_occupancy AS config_occupancy,
  COALESCE(a.actual_occupancy, 0) AS actual_occupancy,
  (COALESCE(a.actual_occupancy, 0) - z.current_occupancy) AS delta
FROM zone_config z
LEFT JOIN actual a ON a.zone_name = z.zone_name
ORDER BY z.zone_name;

-- 2) Sync all zone occupancies to actual values
UPDATE zone_config z
SET
  current_occupancy = COALESCE(a.actual_occupancy, 0),
  updated_at = now()
FROM (
  SELECT
    current_zone AS zone_name,
    COUNT(*)::int AS actual_occupancy
  FROM pallets
  WHERE in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = ''
  GROUP BY current_zone
) a
WHERE z.zone_name = a.zone_name;

-- Set zones with no pallets to 0
UPDATE zone_config z
SET
  current_occupancy = 0,
  updated_at = now()
WHERE NOT EXISTS (
  SELECT 1
  FROM pallets p
  WHERE p.current_zone = z.zone_name
    AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
);

-- 3) Show mismatch report AFTER fix (should all be delta=0)
WITH actual AS (
  SELECT
    current_zone AS zone_name,
    COUNT(*)::int AS actual_occupancy
  FROM pallets
  WHERE in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = ''
  GROUP BY current_zone
)
SELECT
  z.zone_name,
  z.current_occupancy AS config_occupancy,
  COALESCE(a.actual_occupancy, 0) AS actual_occupancy,
  (COALESCE(a.actual_occupancy, 0) - z.current_occupancy) AS delta
FROM zone_config z
LEFT JOIN actual a ON a.zone_name = z.zone_name
ORDER BY z.zone_name;

-- 4) Quick total check
SELECT
  (SELECT COUNT(*)::bigint FROM pallets WHERE in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '') AS pallets_total_not_in_transit,
  (SELECT COALESCE(SUM(current_occupancy),0)::bigint FROM zone_config) AS sum_zone_config_occupancy;

