-- RetiFlux™ — Check Database State (run this FIRST before any migrations)
-- Run in Supabase SQL Editor to see what tables, columns, and functions exist.
-- Use the output to decide which SQL scripts you still need to run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. All tables in public schema
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'TABLES' AS section, table_name AS name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Key columns (zone_config)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'ZONE_CONFIG_COLUMNS' AS section, column_name AS name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'zone_config'
ORDER BY ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Key columns (skus)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'SKUS_COLUMNS' AS section, column_name AS name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'skus'
ORDER BY ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Key columns (replenishment_tasks)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'REPLENISHMENT_TASKS_COLUMNS' AS section, column_name AS name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'replenishment_tasks'
ORDER BY ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. All functions (RPCs)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'FUNCTIONS' AS section, routine_name AS name
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Row counts (quick health check)
-- Note: zone_stock_baseline, replenishment_warnings may not exist yet.
-- If this query errors, run the scripts that create those tables.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM zone_config) AS zone_config,
  (SELECT COUNT(*) FROM zone_transitions) AS zone_transitions,
  (SELECT COUNT(*) FROM skus) AS skus,
  (SELECT COUNT(*) FROM pallets) AS pallets,
  (SELECT COUNT(*) FROM zone_movements) AS zone_movements,
  (SELECT COUNT(*) FROM orders) AS orders,
  (SELECT COUNT(*) FROM replenishment_tasks) AS replenishment_tasks;
