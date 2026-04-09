-- RetiFlux™ PRT — Add recorded_by column to tickets
-- Run in Supabase SQL Editor

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS recorded_by text;
