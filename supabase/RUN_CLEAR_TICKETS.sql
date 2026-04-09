-- RetiFlux™ PRT — Clear tickets & reset serial sequence
-- Run in Supabase SQL Editor when you need a fresh start

-- 1. Delete all tickets (CASCADE if other tables reference tickets)
TRUNCATE TABLE tickets CASCADE;

-- 2. Reset the serial sequence to 1 (next ticket will be PRT000001RF)
ALTER SEQUENCE prt_serial_seq RESTART WITH 1;

-- Optional: If you have data and just want to sync the sequence (no truncate):
-- SELECT sync_prt_sequence();
