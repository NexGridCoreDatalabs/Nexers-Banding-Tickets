-- RetiFlux™ — Home Zone (per-SKU) + Foods & Beverages Zone
-- Run in Supabase SQL Editor
-- Implements: skus.home_zone, Foods & Beverages Zone, zone_transitions

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add home_zone to skus
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE skus ADD COLUMN IF NOT EXISTS home_zone text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Populate home_zone per SKU
-- Detergents → Detergents Zone
-- Soaps & Hygiene → Soaps Zone
-- Beverages, Foods → Foods & Beverages Zone
-- Oils & Fats → Liquids/Oils Zone (oils) or Fats Zone (fats) per SKU
-- ─────────────────────────────────────────────────────────────────────────────

-- By subdivision (simple mappings)
UPDATE skus SET home_zone = 'Detergents Zone' WHERE subdivision = 'Detergents';
UPDATE skus SET home_zone = 'Soaps Zone' WHERE subdivision = 'Soaps & Hygiene';
UPDATE skus SET home_zone = 'Foods & Beverages Zone' WHERE subdivision IN ('Beverages', 'Foods');

-- Oils & Fats: per-SKU. Liquid oils → Liquids/Oils Zone; solid fats → Fats Zone
UPDATE skus SET home_zone = 'Liquids/Oils Zone'
WHERE subdivision = 'Oils & Fats'
  AND (product_name ILIKE '%cooking oil%' OR product_name ILIKE '%vegetable oil%' OR product_name ILIKE '%sunflower oil%' OR product_name ILIKE '%olive oil%' OR product_name ILIKE '%corn oil%');

UPDATE skus SET home_zone = 'Fats Zone'
WHERE subdivision = 'Oils & Fats' AND (home_zone IS NULL OR home_zone = '');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add Foods & Beverages Zone to zone_config
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO zone_config (zone_name, prefix, allows_splitting, fifo_required, shelf_life_days, default_status)
VALUES ('Foods & Beverages Zone', 'F&B', false, true, 365, 'Active')
ON CONFLICT (zone_name) DO UPDATE SET
  prefix = EXCLUDED.prefix,
  fifo_required = EXCLUDED.fifo_required,
  default_status = EXCLUDED.default_status;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Zone transitions for Foods & Beverages Zone
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO zone_transitions (from_zone, to_zone) VALUES
  ('Receiving Area', 'Foods & Beverages Zone'),
  ('Foods & Beverages Zone', 'SuperMarket Area'),
  ('Foods & Beverages Zone', 'Dispatch Loading Area'),
  ('Foods & Beverages Zone', 'QA Hold')
ON CONFLICT (from_zone, to_zone) DO NOTHING;
