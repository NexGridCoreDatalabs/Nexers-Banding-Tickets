-- RetiFlux™ — Pallet colour field on tickets
-- Migration 026: records the physical pallet colour at ticket creation time.
-- Valid values: White | Blue | Green | Yellow | Maroon

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pallet_color text;

COMMENT ON COLUMN tickets.pallet_color IS 'Physical pallet colour selected at ticket creation: White | Blue | Green | Yellow | Maroon';
