-- RetiFlux™ — Stress test transactional reset (CURRENT DB)
-- Purpose:
--   Wipe transactional data while preserving master/config tables:
--     - authorized_users
--     - forklifts
--     - sku_zone_mapping
--     - skus
--     - zone_config
--   Plus zone_transitions is preserved as routing config.
--
-- How to run:
--   1) Run section A (preview) and review tables.
--   2) Set v_apply := true in section B and run section B.

-- ─────────────────────────────────────────────────────────────────────────────
-- A) PREVIEW: tables that will be truncated
-- ─────────────────────────────────────────────────────────────────────────────
WITH keep AS (
  SELECT unnest(ARRAY[
    'authorized_users',
    'forklifts',
    'sku_zone_mapping',
    'skus',
    'zone_config',
    'zone_transitions'
  ]) AS table_name
)
SELECT
  t.table_name
FROM information_schema.tables t
LEFT JOIN keep k ON k.table_name = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND k.table_name IS NULL
ORDER BY t.table_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) APPLY RESET: set v_apply := true to execute
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_apply boolean := true; -- <-- set false to dry-run only
  v_sql text;
BEGIN
  SELECT
    CASE
      WHEN COUNT(*) = 0 THEN NULL
      ELSE 'TRUNCATE TABLE ' ||
           string_agg(format('%I.%I', t.table_schema, t.table_name), ', ' ORDER BY t.table_name) ||
           ' RESTART IDENTITY CASCADE;'
    END
  INTO v_sql
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND t.table_name NOT IN (
      'authorized_users',
      'forklifts',
      'sku_zone_mapping',
      'skus',
      'zone_config',
      'zone_transitions'
    );

  IF v_sql IS NULL THEN
    RAISE NOTICE 'Nothing to truncate.';
    RETURN;
  END IF;

  RAISE NOTICE 'Generated reset SQL: %', v_sql;

  IF v_apply THEN
    EXECUTE v_sql;
    RAISE NOTICE 'Transactional reset completed.';
  ELSE
    RAISE NOTICE 'Dry-run only (v_apply=false). No data changed.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C) POST-CHECK: preserved tables row counts
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'authorized_users' AS table_name, COUNT(*)::bigint AS rows FROM authorized_users
UNION ALL
SELECT 'forklifts', COUNT(*)::bigint FROM forklifts
UNION ALL
SELECT 'sku_zone_mapping', COUNT(*)::bigint FROM sku_zone_mapping
UNION ALL
SELECT 'skus', COUNT(*)::bigint FROM skus
UNION ALL
SELECT 'zone_config', COUNT(*)::bigint FROM zone_config
UNION ALL
SELECT 'zone_transitions', COUNT(*)::bigint FROM zone_transitions
ORDER BY table_name;

