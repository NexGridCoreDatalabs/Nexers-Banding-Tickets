-- ─────────────────────────────────────────────────────────────────────────────
-- Piece-rate remuneration for group leaders: catalogue lookup, shift team N,
-- JSON summary for UI. Voided tickets excluded.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_banding_payout_uom(uom text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN upper(trim(COALESCE(uom, ''))) IN ('BUCKETS', 'BUCKET') THEN 'BUCKET'
    ELSE NULLIF(upper(trim(COALESCE(uom, ''))), '')
  END;
$$;

COMMENT ON FUNCTION normalize_banding_payout_uom(text) IS
  'Uppercase/trim UOM; treat BUCKETS as BUCKET for catalogue matching.';

CREATE OR REPLACE FUNCTION sku_weight_size_key_from_sachet(st text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
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
  IF position('1kg' in s) > 0 AND position('0.5kg' in s) = 0 AND position('3.5kg' in s) = 0 THEN
    RETURN '1KG';
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION sku_weight_size_key_from_sachet(text) IS
  'Map skus.sachet_type text to banding_pay_rate_catalog.weight_size_key (order-sensitive).';

CREATE OR REPLACE FUNCTION gl_shift_remuneration_summary(
  p_leader_name text,
  p_leader_user_id text,
  p_shift_start_iso timestamptz,
  p_ticket_from timestamptz,
  p_ticket_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_n int;
  v_result jsonb;
  v_leader_name text := trim(COALESCE(p_leader_name, ''));
  v_leader_uid text := trim(COALESCE(p_leader_user_id, ''));
BEGIN
  IF v_leader_name = '' OR v_leader_uid = '' THEN
    RETURN jsonb_build_object(
      'team_member_count', 0,
      'total_group_kes', 0,
      'kes_per_person', NULL,
      'ticket_count', 0,
      'priced_ticket_count', 0,
      'unpriced_ticket_count', 0,
      'lines', '[]'::jsonb,
      'error', 'leader_name_and_user_id_required'
    );
  END IF;

  SELECT count(*)::int INTO v_team_n
  FROM gl_shift_team_member g
  WHERE g.shift_start_iso = p_shift_start_iso
    AND lower(trim(g.group_leader_user_id)) = lower(v_leader_uid);

  WITH enriched AS (
    SELECT
      t.serial,
      t.sku,
      t.qty::numeric AS qty,
      normalize_banding_payout_uom(COALESCE(NULLIF(trim(t.uom), ''), s.uom)) AS norm_uom,
      s.banding_demarcation,
      sku_weight_size_key_from_sachet(s.sachet_type) AS wk
    FROM tickets t
    LEFT JOIN skus s ON s.sku = t.sku
    WHERE trim(t.group_leader) = v_leader_name
      AND coalesce(t.voided, false) = false
      AND t.created_at >= p_ticket_from
      AND (p_ticket_to IS NULL OR t.created_at < p_ticket_to)
  ),
  priced AS (
    SELECT
      e.serial,
      e.sku,
      e.qty,
      e.norm_uom,
      e.banding_demarcation,
      e.wk,
      c.rate_kes,
      CASE
        WHEN c.rate_kes IS NOT NULL THEN round(e.qty * c.rate_kes, 4)
        ELSE NULL
      END AS line_kes
    FROM enriched e
    LEFT JOIN banding_pay_rate_catalog c
      ON c.banding_demarcation = e.banding_demarcation
     AND c.weight_size_key = e.wk
     AND c.uom = e.norm_uom
  ),
  agg AS (
    SELECT
      p.sku,
      p.norm_uom AS uom,
      p.rate_kes,
      count(*)::int AS pallet_count,
      sum(p.qty)::numeric AS qty_sum,
      sum(coalesce(p.line_kes, 0::numeric))::numeric AS line_kes_sum
    FROM priced p
    GROUP BY p.sku, p.norm_uom, p.rate_kes
  ),
  stats AS (
    SELECT
      coalesce(sum(p.line_kes), 0::numeric)::numeric(14, 4) AS total_kes,
      count(*) FILTER (WHERE p.rate_kes IS NULL)::int AS unpriced_ticket_count,
      count(*) FILTER (WHERE p.rate_kes IS NOT NULL)::int AS priced_ticket_count,
      count(*)::int AS ticket_count
    FROM priced p
  )
  SELECT jsonb_build_object(
    'team_member_count', v_team_n,
    'total_group_kes', s.total_kes,
    'kes_per_person',
      CASE
        WHEN v_team_n > 0 THEN round(s.total_kes / v_team_n::numeric, 4)
        ELSE NULL
      END,
    'ticket_count', s.ticket_count,
    'priced_ticket_count', s.priced_ticket_count,
    'unpriced_ticket_count', s.unpriced_ticket_count,
    'lines', coalesce(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'sku', a.sku,
          'uom', a.uom,
          'pallet_count', a.pallet_count,
          'qty_sum', a.qty_sum,
          'rate_kes', a.rate_kes,
          'line_kes', round(a.line_kes_sum, 2)
        )
        ORDER BY a.sku, a.uom
      ) FROM agg a),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM stats s;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION gl_shift_remuneration_summary(text, text, timestamptz, timestamptz, timestamptz) IS
  'Group leader pay snapshot: sums qty×rate for non-void tickets in time window; divides by shift roster count.';

GRANT EXECUTE ON FUNCTION normalize_banding_payout_uom(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sku_weight_size_key_from_sachet(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gl_shift_remuneration_summary(text, text, timestamptz, timestamptz, timestamptz) TO anon, authenticated;
