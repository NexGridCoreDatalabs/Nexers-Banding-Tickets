-- RetiFlux™ — RLS policies for tickets table
-- Run in Supabase SQL Editor if inserts are blocked by RLS

DROP POLICY IF EXISTS "tickets_anon_insert" ON tickets;
DROP POLICY IF EXISTS "tickets_anon_select" ON tickets;

CREATE POLICY "tickets_anon_insert" ON tickets FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "tickets_anon_select" ON tickets FOR SELECT TO anon USING (true);
