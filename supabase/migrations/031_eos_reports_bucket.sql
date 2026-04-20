-- RetiFlux™ — EOS Excel Reports storage bucket
-- Migration 031: creates the eos-reports bucket and grants public read access
-- so the Edge Function can upload a file and send the public URL via WhatsApp.
--
-- Run in Supabase SQL Editor (or via supabase db push).

-- ── Create bucket ─────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'eos-reports',
  'eos-reports',
  true,                  -- public read: anyone with the URL can download
  10485760,              -- 10 MB max per file (xlsx will be < 500 KB)
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Storage policies ──────────────────────────────────────────────────────────

-- Allow public (anon) SELECT on any file in the bucket
DROP POLICY IF EXISTS "eos_reports_public_read" ON storage.objects;
CREATE POLICY "eos_reports_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'eos-reports');

-- Allow service_role (used by the Edge Function) to INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "eos_reports_service_write" ON storage.objects;
CREATE POLICY "eos_reports_service_write"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'eos-reports')
  WITH CHECK (bucket_id = 'eos-reports');

-- ── Verify ────────────────────────────────────────────────────────────────────

SELECT id, name, public, file_size_limit
FROM storage.buckets
WHERE id = 'eos-reports';
