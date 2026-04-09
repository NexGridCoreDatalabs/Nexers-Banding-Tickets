-- RetiFlux™ — Default Zone Config (from DEFAULT_ZONE_CONFIG)
-- Run after 001_initial_schema.sql

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

-- Outbonded/Outbounded are final dispatch zones — add if needed for zone_transitions
INSERT INTO zone_config (zone_name, prefix, allows_splitting, fifo_required, default_status)
VALUES ('Outbonded', 'OBD', false, false, 'Outbounded')
ON CONFLICT (zone_name) DO NOTHING;
