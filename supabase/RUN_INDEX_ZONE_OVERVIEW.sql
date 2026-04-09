-- RetiFlux™ — Index for View All Zones (max performance)
-- Run in Supabase SQL Editor for 250+ concurrent users
-- Speeds up: SELECT ... FROM pallets WHERE current_zone IN (...) AND in_transit_to_zone IS NULL

CREATE INDEX IF NOT EXISTS pallets_zone_overview_idx
  ON pallets(current_zone)
  WHERE in_transit_to_zone IS NULL;
