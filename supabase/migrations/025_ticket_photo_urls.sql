-- RetiFlux™ — Ticket photo attachments (Pallet Overview + Batch Label)
-- Migration 025: Two mandatory photo URL columns on tickets.
-- Photos are uploaded to Supabase Storage bucket: prt-photos
-- and their public URLs are stored here at ticket creation time.

-- ── 1. Schema ────────────────────────────────────────────────────────────────
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS photo_1_url text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS photo_2_url text;

COMMENT ON COLUMN tickets.photo_1_url IS 'Pallet Overview photo — Supabase Storage public URL (prt-photos bucket)';
COMMENT ON COLUMN tickets.photo_2_url IS 'Batch Label photo — Supabase Storage public URL (prt-photos bucket)';

-- ── 2. Storage bucket (run ONCE in Supabase SQL editor or dashboard) ─────────
-- If the prt-photos bucket does not yet exist, create it:
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'prt-photos',
    'prt-photos',
    true,                                              -- public read (no signed URL needed)
    10485760,                                          -- 10 MB max per file
    ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif']
  )
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ── 3. Storage RLS: allow anon to upload + read ───────────────────────────────
-- Allow anon to SELECT (view) any object in prt-photos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'prt_photos_anon_select'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "prt_photos_anon_select"
      ON storage.objects FOR SELECT TO anon
      USING (bucket_id = 'prt-photos');
    $pol$;
  END IF;
END $$;

-- Allow anon to INSERT (upload) to prt-photos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'prt_photos_anon_insert'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "prt_photos_anon_insert"
      ON storage.objects FOR INSERT TO anon
      WITH CHECK (bucket_id = 'prt-photos');
    $pol$;
  END IF;
END $$;

-- Allow anon to UPDATE (upsert) objects in prt-photos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'prt_photos_anon_update'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "prt_photos_anon_update"
      ON storage.objects FOR UPDATE TO anon
      USING (bucket_id = 'prt-photos');
    $pol$;
  END IF;
END $$;
