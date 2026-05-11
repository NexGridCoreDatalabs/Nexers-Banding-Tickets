-- ─────────────────────────────────────────────────────────────────────────────
-- Catalogue of piece rates (KES per UOM unit) by banding demarcation + weight tier.
-- Lookup at runtime: match skus.banding_demarcation, skus.uom, and weight tier
-- derived from skus.sachet_type (or a future normalized column) to weight_size_key.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS banding_pay_rate_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banding_demarcation text NOT NULL CHECK (banding_demarcation IN ('banded', 'non_banded')),
  -- Canonical size label for matching (e.g. sachet_type ILIKE '%0.5KG%' → key 0.5KG).
  weight_size_key text NOT NULL,
  rate_kes numeric(12, 4) NOT NULL CHECK (rate_kes >= 0),
  uom text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (banding_demarcation, weight_size_key, uom)
);

COMMENT ON TABLE banding_pay_rate_catalog IS
  'Official banding piece-rate grid: KES per stock unit (UOM) for each banding + weight tier.';

CREATE INDEX IF NOT EXISTS banding_pay_rate_catalog_lookup_idx
  ON banding_pay_rate_catalog (banding_demarcation, uom, weight_size_key);

ALTER TABLE banding_pay_rate_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "banding_pay_rate_catalog_select_anon" ON banding_pay_rate_catalog;
CREATE POLICY "banding_pay_rate_catalog_select_anon"
  ON banding_pay_rate_catalog FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "banding_pay_rate_catalog_select_authenticated" ON banding_pay_rate_catalog;
CREATE POLICY "banding_pay_rate_catalog_select_authenticated"
  ON banding_pay_rate_catalog FOR SELECT TO authenticated USING (true);

INSERT INTO banding_pay_rate_catalog (banding_demarcation, weight_size_key, rate_kes, uom) VALUES
  ('banded',     '0.5KG',  2.5,  'KAR'),
  ('non_banded', '0.5KG',  2.0,  'KAR'),
  ('banded',     '1KG',    2.0,  'KAR'),
  ('non_banded', '1KG',    1.5,  'KAR'),
  ('non_banded', '200G',   1.5,  'KAR'),
  ('non_banded', '100G',   1.5,  'KAR'),
  ('non_banded', '10KG',   3.0,  'SACK'),
  ('non_banded', '3.5KG',  1.5,  'BUCKET'),
  ('non_banded', '5KG',    2.0,  'SACK')
ON CONFLICT (banding_demarcation, weight_size_key, uom) DO UPDATE SET
  rate_kes = EXCLUDED.rate_kes,
  updated_at = now();
