-- RetiFlux™ — Pre-check before RUN_SIMULATION_FILL.sql
-- Run this in Supabase SQL Editor. All ok values should be > 0.
-- zone_config: expect 5. skus_home_zone: expect 100+. zone_stock_baseline: expect 1.

SELECT * FROM (
  SELECT 'zone_config' AS check_name,
    (SELECT COUNT(*) FROM zone_config
     WHERE zone_name IN ('Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone')
       AND max_capacity IS NOT NULL) AS ok
  UNION ALL
  SELECT 'skus_home_zone',
    (SELECT COUNT(*) FROM skus WHERE home_zone IS NOT NULL AND trim(home_zone) != '' AND is_active = true)
  UNION ALL
  SELECT 'zone_stock_baseline',
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'zone_stock_baseline')
) t;
