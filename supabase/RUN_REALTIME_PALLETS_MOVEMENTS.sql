-- Run in Supabase SQL Editor (or: supabase db push / migration apply).
-- Enables Realtime on pallets + zone_movements for live ticket view & filtered subscriptions.

ALTER TABLE public.pallets REPLICA IDENTITY FULL;
ALTER TABLE public.zone_movements REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pallets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pallets;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'zone_movements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.zone_movements;
  END IF;
END $$;
