-- gl_shift_remuneration_summary: remove team-wide fair min/max/avg; add pools[] with exact allocated totals and per-pool per_person_kes.

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
  v_earn jsonb;
  v_by_roster jsonb;
  v_pools_json jsonb;
BEGIN
  IF v_leader_name = '' OR v_leader_uid = '' THEN
      RETURN jsonb_build_object(
        'team_member_count', 0,
        'total_group_kes', 0,
        'kes_per_person_equal_split', NULL,
        'pools', '[]'::jsonb,
        'ticket_count', 0,
        'priced_ticket_count', 0,
        'unpriced_ticket_count', 0,
        'lines', '[]'::jsonb,
        'by_workforce', '[]'::jsonb,
        'error', 'leader_name_and_user_id_required'
      );
  END IF;

  SELECT count(*)::int INTO v_team_n
  FROM gl_shift_team_member g
  WHERE g.shift_start_iso = p_shift_start_iso
    AND lower(trim(g.group_leader_user_id)) = lower(v_leader_uid);

  v_earn := gl_workforce_earnings_leader_scoped(v_leader_uid, p_ticket_from, p_ticket_to);

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'workforce_id', w.id::text,
        'display_name', w.display_name,
        'remuneration_pool', m.remuneration_pool,
        'total_kes', round(coalesce(x.amt, 0), 2)
      )
      ORDER BY w.display_name
    ),
    '[]'::jsonb
  )
  INTO v_by_roster
  FROM gl_shift_team_member m
  JOIN prt_workforce_roster w ON w.id = m.workforce_id
  LEFT JOIN LATERAL (
    SELECT (elem->>'total_kes')::numeric AS amt
    FROM jsonb_array_elements(coalesce(v_earn->'by_workforce', '[]'::jsonb)) AS elem
    WHERE (elem->>'workforce_id')::uuid = w.id
    LIMIT 1
  ) x ON true
  WHERE m.shift_start_iso = p_shift_start_iso
    AND lower(trim(m.group_leader_user_id)) = lower(v_leader_uid);

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pool', q.pool,
        'member_count', q.member_count,
        'total_allocated_kes', round(q.total_amt, 2),
        'per_person_kes',
          CASE
            WHEN q.member_count > 0 THEN round(q.total_amt / q.member_count::numeric, 4)
            ELSE NULL
          END
      )
      ORDER BY CASE WHEN q.pool = 'main' THEN 0 WHEN q.pool = 'small_sku' THEN 1 ELSE 2 END
    ),
    '[]'::jsonb
  )
  INTO v_pools_json
  FROM (
    SELECT
      m.remuneration_pool AS pool,
      count(*)::int AS member_count,
      sum(round(coalesce(x.amt, 0), 4)) AS total_amt
    FROM gl_shift_team_member m
    JOIN prt_workforce_roster w ON w.id = m.workforce_id
    LEFT JOIN LATERAL (
      SELECT (elem->>'total_kes')::numeric AS amt
      FROM jsonb_array_elements(coalesce(v_earn->'by_workforce', '[]'::jsonb)) AS elem
      WHERE (elem->>'workforce_id')::uuid = w.id
      LIMIT 1
    ) x ON true
    WHERE m.shift_start_iso = p_shift_start_iso
      AND lower(trim(m.group_leader_user_id)) = lower(v_leader_uid)
    GROUP BY m.remuneration_pool
  ) q;

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
    'kes_per_person_equal_split',
      CASE
        WHEN v_team_n > 0 THEN round(s.total_kes / v_team_n::numeric, 4)
        ELSE NULL
      END,
    'pools', coalesce(v_pools_json, '[]'::jsonb),
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
    ),
    'by_workforce', coalesce(v_by_roster, '[]'::jsonb)
  )
  INTO v_result
  FROM stats s;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION gl_shift_remuneration_summary(text, text, timestamptz, timestamptz, timestamptz) IS
  'GL pay: SKU lines + by_workforce allocations; pools[] = total allocated per roster pool and per_person_kes = total/members in that pool.';