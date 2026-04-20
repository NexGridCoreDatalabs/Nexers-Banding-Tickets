-- RetiFlux™ — EOS Excel Report cron schedules (pg_cron)
-- Migration 032: fires the eos-excel-report Edge Function at the same times
-- as the existing end-of-shift WhatsApp text report.
--
-- Schedule overview (EAT = UTC+3, no DST):
--   Day shift ends   : 19:00 EAT = 16:00 UTC  → generates Day Shift report
--   Night shift ends : 07:00 EAT = 04:00 UTC  → generates Night Shift report
--
-- The Excel report fires ~30 seconds AFTER the WhatsApp text report so that
-- recipients receive the text summary first, then the Excel link.
-- (pg_cron minute-granularity: we offset to the next minute — 16:01 / 04:01 UTC)
--
-- IMPORTANT: Replace the Authorization Bearer token below with your actual
-- Supabase service_role key if it has changed since migration 028.

-- ── Remove any stale schedules (safe to re-run) ───────────────────────────────

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN (
  'retiflux-excel-eod-day',
  'retiflux-excel-eod-night'
);

-- ── Day shift Excel report (19:01 EAT = 16:01 UTC) ───────────────────────────

SELECT cron.schedule(
  'retiflux-excel-eod-day',
  '1 16 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://dxlsuirjfpcycwurntgs.supabase.co/functions/v1/eos-excel-report',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4bHN1aXJqZnBjeWN3dXJudGdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzM4NDI1OSwiZXhwIjoyMDg4OTYwMjU5fQ.wkiK6Uw3kA9QO4SlHHvS0STnCq07KEygBwaceYMFUFM'
      ),
      body    := '{"shift":"day"}'::jsonb
    );
  $$
);

-- ── Night shift Excel report (07:01 EAT = 04:01 UTC) ─────────────────────────

SELECT cron.schedule(
  'retiflux-excel-eod-night',
  '1 4 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://dxlsuirjfpcycwurntgs.supabase.co/functions/v1/eos-excel-report',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4bHN1aXJqZnBjeWN3dXJudGdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzM4NDI1OSwiZXhwIjoyMDg4OTYwMjU5fQ.wkiK6Uw3kA9QO4SlHHvS0STnCq07KEygBwaceYMFUFM'
      ),
      body    := '{"shift":"night"}'::jsonb
    );
  $$
);

-- ── Verify all RetiFlux schedules ────────────────────────────────────────────

SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'retiflux-%'
ORDER BY jobname;
