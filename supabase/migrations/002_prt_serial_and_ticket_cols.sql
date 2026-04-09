-- RetiFlux™ PRT — Serial sequence + ticket columns
-- Run in Supabase SQL Editor if not using migrations

-- PRT serial sequence (format: PRT000001RF, PRT000002RF, ...)
CREATE SEQUENCE IF NOT EXISTS prt_serial_seq START 1;

CREATE OR REPLACE FUNCTION get_next_prt_serial()
RETURNS text AS $$
  SELECT 'PRT' || LPAD(nextval('prt_serial_seq')::text, 6, '0') || 'RF';
$$ LANGUAGE sql;

-- Optional: set sequence to a higher start if you have existing tickets
-- SELECT setval('prt_serial_seq', 200);

-- Add PRT-specific columns to tickets (if not exists)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS production_line text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS shift text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS subdivision text;
