-- Fair earnings for ONE group leader's tickets only, using the same pool rules as
-- gl_workforce_earnings_shift but:
--   • Only tickets whose group_leader resolves to p_leader_user_id
--   • Membership intervals use prt_shift_start_for_timestamp(ticket time) so ranges
--     like "Today" still match the correct production shift per ticket.
--
-- Requires migration 048 (prt_shift_start_for_timestamp).

CREATE OR REPLACE FUNCTION gl_workforce_earnings_leader_scoped(
  p_leader_user_id text,
  p_ticket_from timestamptz,
  p_ticket_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rticket RECORD;
  v_ticket_gl_uid text;
  v_scope text := trim(lower(COALESCE(p_leader_user_id, '')));
  v_leader_uid text;
  v_line numeric;
  v_small boolean;
  v_n int;
  v_share numeric;
  wid uuid;
  v_t timestamptz;
  v_pool_subset int;
  v_shift timestamptz;
BEGIN
  IF v_scope = '' THEN
    RETURN jsonb_build_object('by_workforce', '[]'::jsonb);
  END IF;

  CREATE TEMP TABLE _earn_scoped (workforce_id uuid PRIMARY KEY, amt numeric NOT NULL DEFAULT 0)
    ON COMMIT DROP;

  FOR rticket IN
    WITH enriched AS (
      SELECT
        t.serial,
        t.created_at AS t,
        t.group_leader AS gl_name,
        t.qty::numeric AS qty,
        normalize_banding_payout_uom(COALESCE(NULLIF(trim(t.uom), ''), s.uom)) AS norm_uom,
        s.banding_demarcation,
        sku_weight_size_key_from_sachet(s.sachet_type) AS wk
      FROM tickets t
      LEFT JOIN skus s ON s.sku = t.sku
      WHERE coalesce(t.voided, false) = false
        AND t.created_at >= p_ticket_from
        AND (p_ticket_to IS NULL OR t.created_at < p_ticket_to)
    ),
    priced AS (
      SELECT
        e.*,
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
    )
    SELECT * FROM priced WHERE line_kes IS NOT NULL
  LOOP
    v_ticket_gl_uid := gl_group_leader_user_id_from_name(rticket.gl_name);
    IF v_ticket_gl_uid IS NULL OR lower(trim(v_ticket_gl_uid)) <> v_scope THEN
      CONTINUE;
    END IF;
    v_leader_uid := v_ticket_gl_uid;
    v_line := rticket.line_kes;
    v_small := gl_ticket_is_small_sku_bucket(rticket.wk, rticket.norm_uom);
    v_t := rticket.t;
    v_shift := prt_shift_start_for_timestamp(v_t);

    IF v_small THEN
      SELECT count(*)::int INTO v_pool_subset
      FROM gl_shift_team_membership_interval i
      WHERE i.shift_start_iso = v_shift
        AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
        AND i.valid_from <= v_t
        AND (i.valid_to IS NULL OR v_t < i.valid_to)
        AND i.remuneration_pool = 'small_sku';
      IF v_pool_subset > 0 THEN
        v_n := v_pool_subset;
      ELSE
        SELECT count(*)::int INTO v_n
        FROM gl_shift_team_membership_interval i
        WHERE i.shift_start_iso = v_shift
          AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND i.valid_from <= v_t
          AND (i.valid_to IS NULL OR v_t < i.valid_to);
      END IF;
    ELSE
      SELECT count(*)::int INTO v_pool_subset
      FROM gl_shift_team_membership_interval i
      WHERE i.shift_start_iso = v_shift
        AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
        AND i.valid_from <= v_t
        AND (i.valid_to IS NULL OR v_t < i.valid_to)
        AND i.remuneration_pool = 'main';
      IF v_pool_subset > 0 THEN
        v_n := v_pool_subset;
      ELSE
        SELECT count(*)::int INTO v_n
        FROM gl_shift_team_membership_interval i
        WHERE i.shift_start_iso = v_shift
          AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND i.valid_from <= v_t
          AND (i.valid_to IS NULL OR v_t < i.valid_to);
      END IF;
    END IF;

    IF v_n IS NULL OR v_n <= 0 THEN
      CONTINUE;
    END IF;

    v_share := v_line / v_n::numeric;

    IF v_small AND v_pool_subset > 0 THEN
      FOR wid IN
        SELECT i.workforce_id
        FROM gl_shift_team_membership_interval i
        WHERE i.shift_start_iso = v_shift
          AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND i.valid_from <= v_t
          AND (i.valid_to IS NULL OR v_t < i.valid_to)
          AND i.remuneration_pool = 'small_sku'
      LOOP
        INSERT INTO _earn_scoped (workforce_id, amt) VALUES (wid, v_share)
        ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_scoped.amt + EXCLUDED.amt;
      END LOOP;
    ELSIF v_small AND v_pool_subset = 0 THEN
      FOR wid IN
        SELECT i.workforce_id
        FROM gl_shift_team_membership_interval i
        WHERE i.shift_start_iso = v_shift
          AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND i.valid_from <= v_t
          AND (i.valid_to IS NULL OR v_t < i.valid_to)
      LOOP
        INSERT INTO _earn_scoped (workforce_id, amt) VALUES (wid, v_share)
        ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_scoped.amt + EXCLUDED.amt;
      END LOOP;
    ELSIF NOT v_small AND v_pool_subset > 0 THEN
      FOR wid IN
        SELECT i.workforce_id
        FROM gl_shift_team_membership_interval i
        WHERE i.shift_start_iso = v_shift
          AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND i.valid_from <= v_t
          AND (i.valid_to IS NULL OR v_t < i.valid_to)
          AND i.remuneration_pool = 'main'
      LOOP
        INSERT INTO _earn_scoped (workforce_id, amt) VALUES (wid, v_share)
        ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_scoped.amt + EXCLUDED.amt;
      END LOOP;
    ELSE
      FOR wid IN
        SELECT i.workforce_id
        FROM gl_shift_team_membership_interval i
        WHERE i.shift_start_iso = v_shift
          AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND i.valid_from <= v_t
          AND (i.valid_to IS NULL OR v_t < i.valid_to)
      LOOP
        INSERT INTO _earn_scoped (workforce_id, amt) VALUES (wid, v_share)
        ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_scoped.amt + EXCLUDED.amt;
      END LOOP;
    END IF;
  END LOOP;

  RETURN COALESCE(
    (SELECT jsonb_build_object(
      'by_workforce',
      coalesce(jsonb_agg(
        jsonb_build_object(
          'workforce_id', w.workforce_id,
          'display_name', w.display_name,
          'total_kes', round(e.amt, 2)
        )
        ORDER BY w.display_name
      ), '[]'::jsonb)
    )
    FROM _earn_scoped e
    JOIN prt_workforce_roster w ON w.id = e.workforce_id),
    jsonb_build_object('by_workforce', '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION gl_workforce_earnings_leader_scoped(text, timestamptz, timestamptz) IS
  'Fair piece-rate totals for one leader tickets only; pools + per-ticket shift start.';

GRANT EXECUTE ON FUNCTION gl_workforce_earnings_leader_scoped(text, timestamptz, timestamptz) TO anon, authenticated;

-- GL panel: SKU lines unchanged; fair by_workforce + min/max/avg from leader-scoped earnings.

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
  v_fair_min numeric;
  v_fair_max numeric;
  v_fair_avg numeric;
BEGIN
  IF v_leader_name = '' OR v_leader_uid = '' THEN
      RETURN jsonb_build_object(
        'team_member_count', 0,
        'total_group_kes', 0,
        'kes_per_person', NULL,
        'kes_per_person_equal_split', NULL,
        'fair_kes_min', NULL,
        'fair_kes_max', NULL,
        'fair_kes_avg', NULL,
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
  ),
  min(round(coalesce(x.amt, 0), 4)),
  max(round(coalesce(x.amt, 0), 4)),
  CASE
    WHEN v_team_n > 0
    THEN round(sum(round(coalesce(x.amt, 0), 4)) / v_team_n::numeric, 4)
    ELSE NULL
  END
  INTO v_by_roster, v_fair_min, v_fair_max, v_fair_avg
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
    'kes_per_person', v_fair_avg,
    'kes_per_person_equal_split',
      CASE
        WHEN v_team_n > 0 THEN round(s.total_kes / v_team_n::numeric, 4)
        ELSE NULL
      END,
    'fair_kes_min', v_fair_min,
    'fair_kes_max', v_fair_max,
    'fair_kes_avg', v_fair_avg,
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
  'GL pay: SKU lines + fair pool split for this leader tickets; by_workforce matches current shift roster.';
