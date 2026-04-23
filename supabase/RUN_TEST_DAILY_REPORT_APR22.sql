-- RetiFlux™ — Manual End-of-Day Report Trigger
-- Full Day: Tue 22 Apr 2026  (Day Shift 07:00–19:00 + Night Shift 19:00–07:00 EAT)
--
-- Two equivalent ways to call it:
--
-- Option A — Pass an explicit date (simplest):

SELECT net.http_post(
  url     := 'https://dxlsuirjfpcycwurntgs.supabase.co/functions/v1/eos-daily-report',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4bHN1aXJqZnBjeWN3dXJudGdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzM4NDI1OSwiZXhwIjoyMDg4OTYwMjU5fQ.wkiK6Uw3kA9QO4SlHHvS0STnCq07KEygBwaceYMFUFM'
  ),
  body := '{"date":"2026-04-22"}'::jsonb
) AS daily_report_apr22_explicit;

-- Option B — Simulate the auto-trigger (cron fires at 07:00 EAT Apr 23 = 04:00 UTC Apr 23):
--
-- SELECT net.http_post(
--   url     := 'https://dxlsuirjfpcycwurntgs.supabase.co/functions/v1/eos-daily-report',
--   headers := jsonb_build_object(
--     'Content-Type',  'application/json',
--     'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4bHN1aXJqZnBjeWN3dXJudGdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzM4NDI1OSwiZXhwIjoyMDg4OTYwMjU5fQ.wkiK6Uw3kA9QO4SlHHvS0STnCq07KEygBwaceYMFUFM'
--   ),
--   body := '{"mock_now":"2026-04-23T04:00:00Z"}'::jsonb
-- ) AS daily_report_apr22_via_clock;

-- ── What to expect ─────────────────────────────────────────────────────────────
-- File name  : RetiFlux_DAILY_2026-04-22.xlsx  (in eos-reports bucket)
-- Tabs       : Daily Overview · By Line · SKU Breakdown · 7-Day Trend
-- WhatsApp   : Summary text with total pallets/tonnes + link to file
-- Date label : "Tuesday, 22 April 2026" on all tabs
