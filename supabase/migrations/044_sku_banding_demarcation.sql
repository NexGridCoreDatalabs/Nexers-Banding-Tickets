-- ─────────────────────────────────────────────────────────────────────────────
-- SKU pay / operations demarcation: banded vs non-banded (e.g. promo tablet units).
-- Rates and rules can key off this column later.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS banding_demarcation text NOT NULL DEFAULT 'non_banded';

ALTER TABLE skus
  DROP CONSTRAINT IF EXISTS skus_banding_demarcation_check;

ALTER TABLE skus
  ADD CONSTRAINT skus_banding_demarcation_check
  CHECK (banding_demarcation IN ('banded', 'non_banded'));

COMMENT ON COLUMN skus.banding_demarcation IS
  'Demarcation for banding-related pay or planning: banded (e.g. strapped + tablet promo) vs non_banded.';

CREATE INDEX IF NOT EXISTS skus_banding_demarcation_idx
  ON skus (banding_demarcation)
  WHERE is_active = true;

-- Example backfill (uncomment and adjust after business sign-off):
-- UPDATE skus SET banding_demarcation = 'banded'
-- WHERE tablet_type IS NOT NULL
--   AND tablet_type ILIKE '%100g%'
--   AND sachet_type ILIKE '%0.5KG%';
