-- RetiFlux™ PRT — Run in Supabase SQL Editor after RUN_IN_SQL_EDITOR.sql
-- Adds: serial sequence, get_next_prt_serial(), ticket columns, RLS policies

CREATE SEQUENCE IF NOT EXISTS prt_serial_seq START 1;

CREATE OR REPLACE FUNCTION get_next_prt_serial()
RETURNS text AS $$
  SELECT 'PRT' || LPAD(nextval('prt_serial_seq')::text, 6, '0') || 'RF';
$$ LANGUAGE sql SECURITY DEFINER;

-- Sync sequence with max serial (run after manual DB fixes to avoid gaps)
CREATE OR REPLACE FUNCTION sync_prt_sequence()
RETURNS void AS $$
DECLARE
  max_n integer;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(serial FROM 4 FOR 6) AS integer)), 0) INTO max_n
  FROM tickets WHERE serial ~ '^PRT[0-9]{6}RF$';
  PERFORM setval('prt_serial_seq', max_n + 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS production_line text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS shift text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS subdivision text;

-- RLS: allow anon to insert & select tickets (PRT form uses anon key)
CREATE POLICY "tickets_anon_insert" ON tickets FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "tickets_anon_select" ON tickets FOR SELECT TO anon USING (true);
