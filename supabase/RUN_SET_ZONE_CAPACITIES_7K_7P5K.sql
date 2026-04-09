-- RetiFlux™ — Set curated zone capacities for 7k–7.5k profile
-- Purpose:
--   Update zone_config.max_capacity with a curated distribution where:
--     - Base warehouse capacity (excluding SuperMarket) = 7,500
--     - SuperMarket capacity = 30% of base (2,250)
--     - Receiving Area and Outbonded remain uncapped (NULL)
--
-- Notes:
--   1) Adjust v_base_capacity / v_sm_ratio if needed.
--   2) Adjust zone weights in seed_weights CTE if you want different split.
--   3) Run in Supabase SQL Editor.

BEGIN;

-- 0) Optional preview of current capacities (before update)
SELECT
  zone_name,
  max_capacity AS old_max_capacity,
  current_occupancy
FROM zone_config
ORDER BY zone_name;

-- 1) Capacity model:
--    - Base capped zones (excluding SuperMarket) = 7,500
--    - SuperMarket = 30% of base (on top)
--    - Receiving Area and Outbonded are uncapped (NULL)
DO $$
DECLARE
  v_base_capacity int := 7500;
  v_sm_ratio numeric := 0.30;
  v_sm_capacity int;
  v_sum_alloc int;
  v_dispatch_target int;
BEGIN
  v_sm_capacity := CEIL(v_base_capacity * v_sm_ratio)::int;

  -- Set uncapped zones
  UPDATE zone_config
  SET max_capacity = NULL, updated_at = now()
  WHERE zone_name IN ('Receiving Area', 'Outbonded');

  -- Set SuperMarket cap independently (30% of base)
  UPDATE zone_config
  SET max_capacity = v_sm_capacity, updated_at = now()
  WHERE zone_name = 'SuperMarket Area';

  -- Weighted split for capped zones (sum weights = 1.00)
  WITH seed_weights AS (
    SELECT *
    FROM (VALUES
      ('Detergents Zone',        0.20::numeric),
      ('Fats Zone',              0.20::numeric),
      ('Liquids/Oils Zone',      0.22::numeric),
      ('Soaps Zone',             0.18::numeric),
      ('Foods & Beverages Zone', 0.14::numeric),
      ('Dispatch Loading Area',  0.01::numeric),
      ('QA Hold',                0.005::numeric),
      ('Rework Zone',            0.005::numeric)
    ) AS t(zone_name, w)
  ),
  alloc AS (
    SELECT zone_name, GREATEST(1, FLOOR(v_base_capacity * w)::int) AS cap
    FROM seed_weights
  )
  UPDATE zone_config z
  SET max_capacity = a.cap, updated_at = now()
  FROM alloc a
  WHERE z.zone_name = a.zone_name;

  -- Ensure exact base total = 7,500 by placing remainder into Dispatch Loading Area
  SELECT COALESCE(SUM(max_capacity), 0) INTO v_sum_alloc
  FROM zone_config
  WHERE zone_name NOT IN ('Receiving Area', 'Outbonded', 'SuperMarket Area')
    AND max_capacity IS NOT NULL;

  IF v_sum_alloc <> v_base_capacity THEN
    SELECT COALESCE(max_capacity, 0) INTO v_dispatch_target
    FROM zone_config
    WHERE zone_name = 'Dispatch Loading Area'
    LIMIT 1;

    UPDATE zone_config
    SET max_capacity = GREATEST(1, v_dispatch_target + (v_base_capacity - v_sum_alloc)),
        updated_at = now()
    WHERE zone_name = 'Dispatch Loading Area';
  END IF;
END $$;

-- 2) Post-check: show updated capacities + occupancy pressure
SELECT
  z.zone_name,
  z.max_capacity,
  z.current_occupancy,
  CASE
    WHEN z.max_capacity IS NULL OR z.max_capacity <= 0 THEN NULL
    ELSE ROUND((z.current_occupancy::numeric / z.max_capacity::numeric) * 100, 2)
  END AS occupancy_pct
FROM zone_config z
ORDER BY z.zone_name;

-- 3) Quick aggregate checks
SELECT
  COALESCE(SUM(CASE WHEN zone_name NOT IN ('Receiving Area', 'Outbonded', 'SuperMarket Area') THEN max_capacity END), 0) AS base_capacity_excluding_sm,
  COALESCE(SUM(CASE WHEN zone_name = 'SuperMarket Area' THEN max_capacity END), 0) AS supermarket_capacity,
  COALESCE(SUM(CASE WHEN zone_name NOT IN ('Receiving Area', 'Outbonded') THEN max_capacity END), 0) AS total_capped_wh_including_sm,
  COALESCE(SUM(current_occupancy), 0) AS total_current_occupancy_all_zones
FROM zone_config
;

-- 4) Explicit uncapped checks (should be NULL/unbounded)
SELECT zone_name, max_capacity
FROM zone_config
WHERE zone_name IN ('Receiving Area', 'Outbonded')
ORDER BY zone_name;

COMMIT;

