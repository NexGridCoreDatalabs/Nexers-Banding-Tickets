-- Add SuperMarket Area → Rework Zone transition (per movements logic)
-- SM can push to Dispatch Loading Area, Rework Zone, QA Hold
INSERT INTO zone_transitions (from_zone, to_zone) VALUES
  ('SuperMarket Area', 'Rework Zone')
ON CONFLICT (from_zone, to_zone) DO NOTHING;
