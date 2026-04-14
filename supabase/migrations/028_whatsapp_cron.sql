-- RetiFlux™ — WhatsApp report cron schedules (pg_cron)
-- All times in UTC. Kenya is EAT = UTC+3 (no DST, fixed offset year-round).
--
-- Schedule overview:
--   Hourly pulse   : every hour on the hour, 04:00–16:00 UTC (07:00–19:00 EAT day)
--                    + 16:00–04:00 UTC (19:00–07:00 EAT night)
--                    = every hour 00:00–23:00 UTC (all hours covered)
--   End of day shift  : 16:00 UTC daily  (= 19:00 EAT)
--   End of night shift: 04:00 UTC daily  (= 07:00 EAT)
--
-- IMPORTANT: pg_cron requires the pg_cron extension to be enabled.
-- In Supabase: Dashboard → Database → Extensions → enable pg_cron
-- Then run this script in the SQL editor.
--
-- Replace <YOUR_SERVICE_ROLE_KEY> with your Supabase service_role key.
-- Get it from: Supabase dashboard → Settings → API → service_role (secret key)
-- (Only used inside the DB to call the function — never exposed to clients.)

-- ── Enable required extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;   -- needed for HTTP calls from pg_cron

-- ── Remove any existing schedules (safe to re-run) ───────────────────────────
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN (
  'retiflux-whatsapp-hourly',
  'retiflux-whatsapp-eod-day',
  'retiflux-whatsapp-eod-night'
);

-- ── Hourly pulse (every hour, every day) ─────────────────────────────────────
-- Fires at minute 0 of every hour UTC = minute 0 of every hour EAT
SELECT cron.schedule(
  'retiflux-whatsapp-hourly',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://dxlsuirjfpcycwurntgs.supabase.co/functions/v1/whatsapp-report',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
      ),
      body    := '{"type":"hourly"}'::jsonb
    );
  $$
);

-- ── End of Day Shift (19:00 EAT = 16:00 UTC) ─────────────────────────────────
SELECT cron.schedule(
  'retiflux-whatsapp-eod-day',
  '0 16 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://dxlsuirjfpcycwurntgs.supabase.co/functions/v1/whatsapp-report',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
      ),
      body    := '{"type":"end_of_shift","shift":"day"}'::jsonb
    );
  $$
);

-- ── End of Night Shift (07:00 EAT = 04:00 UTC) ───────────────────────────────
SELECT cron.schedule(
  'retiflux-whatsapp-eod-night',
  '0 4 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://dxlsuirjfpcycwurntgs.supabase.co/functions/v1/whatsapp-report',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
      ),
      body    := '{"type":"end_of_shift","shift":"night"}'::jsonb
    );
  $$
);

-- ── Verify schedules ──────────────────────────────────────────────────────────
SELECT jobname, schedule, command FROM cron.job
WHERE jobname LIKE 'retiflux-%'
ORDER BY jobname;
