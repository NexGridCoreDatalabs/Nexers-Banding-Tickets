-- RetiFlux™ — SEED ONLY (schema already exists)
-- Run this in Supabase SQL Editor

-- Zone config (default zones)
INSERT INTO zone_config (zone_name, prefix, allows_splitting, fifo_required, shelf_life_days, default_status)
VALUES
  ('Receiving Area', 'REC', false, false, NULL, 'Received'),
  ('Detergents Zone', 'DET', false, true, 180, 'Active'),
  ('Fats Zone', 'FAT', false, true, 180, 'Active'),
  ('Liquids/Oils Zone', 'LIQ', false, true, 120, 'Active'),
  ('Soaps Zone', 'SOP', false, true, 240, 'Active'),
  ('SuperMarket Area', 'SM', true, true, NULL, 'Active'),
  ('QA Hold', 'QAH', false, false, NULL, 'Hold'),
  ('Rework Zone', 'REW', false, false, NULL, 'Rework'),
  ('Dispatch Loading Area', 'DSP', false, true, NULL, 'Dispatch'),
  ('Outbounding', 'OUT', false, false, NULL, 'Shipped')
ON CONFLICT (zone_name) DO NOTHING;

INSERT INTO zone_config (zone_name, prefix, allows_splitting, fifo_required, default_status)
VALUES ('Outbonded', 'OBD', false, false, 'Outbounded')
ON CONFLICT (zone_name) DO NOTHING;

-- Zone transitions (routing rules)
INSERT INTO zone_transitions (from_zone, to_zone) VALUES
  ('Receiving Area', 'Detergents Zone'),
  ('Receiving Area', 'Fats Zone'),
  ('Receiving Area', 'Liquids/Oils Zone'),
  ('Receiving Area', 'Soaps Zone'),
  ('Receiving Area', 'SuperMarket Area'),
  ('Receiving Area', 'QA Hold'),
  ('Receiving Area', 'Rework Zone'),
  ('Receiving Area', 'Dispatch Loading Area'),
  ('Detergents Zone', 'SuperMarket Area'),
  ('Detergents Zone', 'Dispatch Loading Area'),
  ('Detergents Zone', 'QA Hold'),
  ('Fats Zone', 'SuperMarket Area'),
  ('Fats Zone', 'Dispatch Loading Area'),
  ('Fats Zone', 'QA Hold'),
  ('Liquids/Oils Zone', 'SuperMarket Area'),
  ('Liquids/Oils Zone', 'Dispatch Loading Area'),
  ('Liquids/Oils Zone', 'QA Hold'),
  ('Soaps Zone', 'SuperMarket Area'),
  ('Soaps Zone', 'Dispatch Loading Area'),
  ('Soaps Zone', 'QA Hold'),
  ('Rework Zone', 'Receiving Area'),
  ('Rework Zone', 'QA Hold'),
  ('Rework Zone', 'SuperMarket Area'),
  ('SuperMarket Area', 'SuperMarket Area'),
  ('SuperMarket Area', 'Dispatch Loading Area'),
  ('SuperMarket Area', 'QA Hold'),
  ('QA Hold', 'Rework Zone'),
  ('QA Hold', 'Dispatch Loading Area'),
  ('QA Hold', 'SuperMarket Area'),
  ('QA Hold', 'QA Hold'),
  ('Dispatch Loading Area', 'Outbounding'),
  ('Dispatch Loading Area', 'Rework Zone'),
  ('Dispatch Loading Area', 'QA Hold'),
  ('Dispatch Loading Area', 'SuperMarket Area'),
  ('Outbounding', 'Outbonded'),
  ('Outbounding', 'Rework Zone'),
  ('Outbounding', 'QA Hold')
ON CONFLICT (from_zone, to_zone) DO NOTHING;
