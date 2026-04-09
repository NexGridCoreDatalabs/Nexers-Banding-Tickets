-- RetiFlux™ PRT — Updates: recorded_by, clear script reference
-- Run after RUN_PRT_MIGRATION.sql

-- Add recorded_by for who created the ticket (pre-auth)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS recorded_by text;
