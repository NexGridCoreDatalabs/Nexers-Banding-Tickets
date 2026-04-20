-- RetiFlux™ — SKU weight & pack metadata
-- Migration 030: adds units_per_carton and net_weight_kg_per_unit to skus.
--
-- units_per_carton   : auto-populated from the trailing count in the SKU code
--                      e.g. MSAFI-LAV-500-12 → 12,  GBAND-25G-144 → 144
-- net_weight_kg_per_unit : net declared fill weight per inner unit (kg).
--                      Auto-filled where the SKU encodes grams or KG.
--                      Liquids (L / ML) need manual entry — see comment block below.
--
-- After running, fill in the oil/liquid net weights manually:
--   UPDATE skus SET net_weight_kg_per_unit = <value> WHERE sku = '<code>';

-- ── Add columns ───────────────────────────────────────────────────────────────

ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS units_per_carton        integer,
  ADD COLUMN IF NOT EXISTS net_weight_kg_per_unit  numeric(10,4);

COMMENT ON COLUMN skus.units_per_carton       IS 'Inner units per outer carton (auto-parsed from SKU code)';
COMMENT ON COLUMN skus.net_weight_kg_per_unit IS 'Declared net fill weight per single inner unit, in kg. Used for tonnage calculation.';

-- ── Auto-fill units_per_carton (trailing number in SKU) ───────────────────────

UPDATE skus
SET units_per_carton = CAST(
      regexp_replace(sku, '^.*-(\d+)$', '\1')
    AS integer)
WHERE sku ~ '-\d+$'
  AND units_per_carton IS NULL;

-- ── Auto-fill net_weight_kg_per_unit where derivable from SKU code ────────────
-- Rule: second-to-last SKU segment encodes the pack size.
--   Pure number  (e.g. "500" in MSAFI-LAV-500-12) → assume grams → ÷ 1000
--   Ends in G    (e.g. "25G" in GBAND-25G-144)    → grams          → ÷ 1000
--   Ends in KG   (e.g. "1KG" in MSAFI-WHT-1KG-6)  → kilograms      → as-is
--   Ends in ML / L → density unknown (oils, beverages) → leave NULL, fill manually

-- Helper: extract second-to-last segment of the dash-delimited SKU code
-- e.g. 'MSAFI-LAV-500-12' → '500',  'GBAND-25G-144' → '25G',  'ELI-2L-12' → '2L'

-- Pure integer segment → grams
UPDATE skus
SET net_weight_kg_per_unit =
  CAST(
    split_part(sku, '-', array_length(string_to_array(sku, '-'), 1) - 1)
  AS numeric) / 1000
WHERE split_part(sku, '-', array_length(string_to_array(sku, '-'), 1) - 1) ~ '^\d+$'
  AND net_weight_kg_per_unit IS NULL;

-- Ends in G (e.g. 25G, 100G, 200G, 400G, 500G)
UPDATE skus
SET net_weight_kg_per_unit =
  CAST(
    regexp_replace(
      split_part(sku, '-', array_length(string_to_array(sku, '-'), 1) - 1),
      '[Gg]$', ''
    )
  AS numeric) / 1000
WHERE split_part(sku, '-', array_length(string_to_array(sku, '-'), 1) - 1) ~ '^\d+[Gg]$'
  AND net_weight_kg_per_unit IS NULL;

-- Ends in KG (e.g. 1KG, 2KG)
UPDATE skus
SET net_weight_kg_per_unit =
  CAST(
    regexp_replace(
      split_part(sku, '-', array_length(string_to_array(sku, '-'), 1) - 1),
      '[Kk][Gg]$', ''
    )
  AS numeric)
WHERE split_part(sku, '-', array_length(string_to_array(sku, '-'), 1) - 1) ~ '^\d+[Kk][Gg]$'
  AND net_weight_kg_per_unit IS NULL;

-- ── Verify results ────────────────────────────────────────────────────────────

SELECT
  sku,
  product_name,
  units_per_carton,
  net_weight_kg_per_unit,
  CASE
    WHEN net_weight_kg_per_unit IS NULL THEN '⚠ FILL MANUALLY'
    ELSE ROUND(units_per_carton * net_weight_kg_per_unit, 3)::text || ' kg/carton'
  END AS carton_net_weight
FROM skus
ORDER BY subdivision, sku;

-- ── Manual fill guide for oils and liquids ───────────────────────────────────
-- Run these after confirming declared net fill weights with the brand team.
--
-- Example for Elianto Corn Oil 2L (net fill ~1.84 kg per bottle at 0.92 g/mL):
--   UPDATE skus SET net_weight_kg_per_unit = 1.840 WHERE sku = 'ELI-2L-12';
--   UPDATE skus SET net_weight_kg_per_unit = 4.600 WHERE sku = 'ELI-5L-4';
--   UPDATE skus SET net_weight_kg_per_unit = 0.460 WHERE sku = 'ELI-500ML-24';
--   UPDATE skus SET net_weight_kg_per_unit = 0.920 WHERE sku = 'ELI-1L-12';
--   UPDATE skus SET net_weight_kg_per_unit = 2.760 WHERE sku = 'ELI-3L-6';
--   UPDATE skus SET net_weight_kg_per_unit = 9.200 WHERE sku = 'ELI-10L-4';
--   UPDATE skus SET net_weight_kg_per_unit = 18.40 WHERE sku = 'ELI-20L-2';
-- (Repeat similarly for GFRY, SGOLD, BAHARI, UFUTA, SOYA, OLIVE, beverages.)
