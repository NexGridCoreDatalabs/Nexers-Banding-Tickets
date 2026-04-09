-- RetiFlux™ — Valid Zone Transitions (from getAllowedDestinations)
-- Run after 001_zone_config.sql
-- Enforces routing at backend: only these from→to pairs are allowed

INSERT INTO zone_transitions (from_zone, to_zone) VALUES
  -- Receiving Area → all except Outbounding, Outbonded
  ('Receiving Area', 'Detergents Zone'),
  ('Receiving Area', 'Fats Zone'),
  ('Receiving Area', 'Liquids/Oils Zone'),
  ('Receiving Area', 'Soaps Zone'),
  ('Receiving Area', 'SuperMarket Area'),
  ('Receiving Area', 'QA Hold'),
  ('Receiving Area', 'Rework Zone'),
  ('Receiving Area', 'Dispatch Loading Area'),
  -- Product zones → SM, DSP, QAH
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
  -- Rework Zone → REC, QAH, SM
  ('Rework Zone', 'Receiving Area'),
  ('Rework Zone', 'QA Hold'),
  ('Rework Zone', 'SuperMarket Area'),
  -- SuperMarket Area → SM (self), DSP, Rework, QAH
  ('SuperMarket Area', 'SuperMarket Area'),
  ('SuperMarket Area', 'Dispatch Loading Area'),
  ('SuperMarket Area', 'Rework Zone'),
  ('SuperMarket Area', 'QA Hold'),
  -- QA Hold → REW, DSP, SM, QAH (self)
  ('QA Hold', 'Rework Zone'),
  ('QA Hold', 'Dispatch Loading Area'),
  ('QA Hold', 'SuperMarket Area'),
  ('QA Hold', 'QA Hold'),
  -- Dispatch Loading Area → Outbounding, REW, QAH, SM
  ('Dispatch Loading Area', 'Outbounding'),
  ('Dispatch Loading Area', 'Rework Zone'),
  ('Dispatch Loading Area', 'QA Hold'),
  ('Dispatch Loading Area', 'SuperMarket Area'),
  -- Outbounding → Outbonded, REW, QAH
  ('Outbounding', 'Outbonded'),
  ('Outbounding', 'Rework Zone'),
  ('Outbounding', 'QA Hold')
ON CONFLICT (from_zone, to_zone) DO NOTHING;
