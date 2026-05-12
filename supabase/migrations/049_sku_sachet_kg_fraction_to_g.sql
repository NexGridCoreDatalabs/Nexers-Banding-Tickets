-- Treat 0.1 kg / 0.2 kg (and comma decimals) as 100G / 200G for catalogue + small-SKU rules.
-- Must run before the generic 1KG branch: "0.1kg" contains substring "1kg" in older PostgreSQL? 
-- Actually "0.1kg" contains "1kg" at indices 3-5 — so without this fix it wrongly mapped to 1KG.

CREATE OR REPLACE FUNCTION sku_weight_size_key_from_sachet(st text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  s text;
BEGIN
  s := lower(trim(COALESCE(st, '')));
  IF s = '' THEN
    RETURN NULL;
  END IF;
  IF position('3.5kg' in s) > 0 OR position('3,5kg' in s) > 0 THEN
    RETURN '3.5KG';
  END IF;
  IF position('0.5kg' in s) > 0 OR position('0,5kg' in s) > 0 THEN
    RETURN '0.5KG';
  END IF;
  IF position('0.2kg' in s) > 0 OR position('0,2kg' in s) > 0 THEN
    RETURN '200G';
  END IF;
  IF position('0.1kg' in s) > 0 OR position('0,1kg' in s) > 0 THEN
    RETURN '100G';
  END IF;
  IF position('10kg' in s) > 0 THEN
    RETURN '10KG';
  END IF;
  IF s ~ '(^|[^0-9.])5kg' THEN
    RETURN '5KG';
  END IF;
  IF position('200g' in s) > 0 THEN
    RETURN '200G';
  END IF;
  IF position('100g' in s) > 0 THEN
    RETURN '100G';
  END IF;
  IF position('1kg' in s) > 0 AND position('0.5kg' in s) = 0 AND position('3.5kg' in s) = 0
     AND position('0.1kg' in s) = 0 AND position('0,1kg' in s) = 0
     AND position('0.2kg' in s) = 0 AND position('0,2kg' in s) = 0 THEN
    RETURN '1KG';
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION sku_weight_size_key_from_sachet(text) IS
  'Map skus.sachet_type to banding_pay_rate_catalog.weight_size_key: 0.1kg/0.2kg → 100G/200G; gram and kg patterns; order-sensitive.';
