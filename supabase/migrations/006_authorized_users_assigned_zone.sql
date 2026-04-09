-- Migration 006: Add assigned_zone to authorized_users for Zone Clerk role
ALTER TABLE authorized_users
  ADD COLUMN IF NOT EXISTS assigned_zone text REFERENCES zone_config(zone_name);

CREATE INDEX IF NOT EXISTS authorized_users_assigned_zone_idx ON authorized_users(assigned_zone);

COMMENT ON COLUMN authorized_users.assigned_zone IS 'Zone assigned to Zone Clerk or Receiving Clerk; used for zone-scoped UI';
