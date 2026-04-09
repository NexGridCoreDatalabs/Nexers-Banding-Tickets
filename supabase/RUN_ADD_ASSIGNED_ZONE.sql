-- Run this in Supabase SQL Editor after migrations
-- Adds assigned_zone to authorized_users for Zone Clerk / Receiving Clerk

-- Migration 006
ALTER TABLE authorized_users
  ADD COLUMN IF NOT EXISTS assigned_zone text REFERENCES zone_config(zone_name);

CREATE INDEX IF NOT EXISTS authorized_users_assigned_zone_idx ON authorized_users(assigned_zone);
