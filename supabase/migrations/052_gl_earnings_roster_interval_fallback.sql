-- When no gl_shift_team_membership_interval covers ticket time, fall back to
-- gl_shift_team_member for that shift so every priced line is allocated (totals match catalogue).
CREATE OR REPLACE FUNCTION gl_workforce_earnings_shift(
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
  rticket RECORD;
  v_leader_uid text;
  v_line numeric;
  v_small boolean;
  v_n int;
  v_share numeric;
  wid uuid;
  v_t timestamptz;
  v_pool_subset int;
  v_fallback boolean := false;
BEGIN
  CREATE TEMP TABLE _earn_acc (workforce_id uuid PRIMARY KEY, amt numeric NOT NULL DEFAULT 0)
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
    v_leader_uid := gl_group_leader_user_id_from_name(rticket.gl_name);
    IF v_leader_uid IS NULL THEN
      CONTINUE;
    END IF;
    v_line := rticket.line_kes;
    v_small := gl_ticket_is_small_sku_bucket(rticket.wk, rticket.norm_uom);
    v_t := rticket.t;

    IF v_small THEN
      SELECT count(*)::int INTO v_pool_subset
      FROM gl_shift_team_membership_interval i
      WHERE i.shift_start_iso = p_shift_start_iso
        AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
        AND i.valid_from <= v_t
        AND (i.valid_to IS NULL OR v_t < i.valid_to)
        AND i.remuneration_pool = 'small_sku';
      IF v_pool_subset > 0 THEN
        v_n := v_pool_subset;
      ELSE
        SELECT count(*)::int INTO v_n
        FROM gl_shift_team_membership_interval i
        WHERE i.shift_start_iso = p_shift_start_iso
          AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND i.valid_from <= v_t
          AND (i.valid_to IS NULL OR v_t < i.valid_to);
      END IF;
    ELSE
      SELECT count(*)::int INTO v_pool_subset
      FROM gl_shift_team_membership_interval i
      WHERE i.shift_start_iso = p_shift_start_iso
        AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
        AND i.valid_from <= v_t
        AND (i.valid_to IS NULL OR v_t < i.valid_to)
        AND i.remuneration_pool = 'main';
      IF v_pool_subset > 0 THEN
        v_n := v_pool_subset;
      ELSE
        SELECT count(*)::int INTO v_n
        FROM gl_shift_team_membership_interval i
        WHERE i.shift_start_iso = p_shift_start_iso
          AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND i.valid_from <= v_t
          AND (i.valid_to IS NULL OR v_t < i.valid_to);
      END IF;
    END IF;

    v_fallback := false;
    IF v_n IS NULL OR v_n <= 0 THEN
      v_fallback := true;
      IF v_small THEN
        SELECT count(*)::int INTO v_pool_subset
        FROM gl_shift_team_member m
        WHERE m.shift_start_iso = p_shift_start_iso
          AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND m.remuneration_pool = 'small_sku';
        IF v_pool_subset > 0 THEN
          v_n := v_pool_subset;
        ELSE
          v_pool_subset := 0;
          SELECT count(*)::int INTO v_n
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = p_shift_start_iso
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid));
        END IF;
      ELSE
        SELECT count(*)::int INTO v_pool_subset
        FROM gl_shift_team_member m
        WHERE m.shift_start_iso = p_shift_start_iso
          AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND m.remuneration_pool = 'main';
        IF v_pool_subset > 0 THEN
          v_n := v_pool_subset;
        ELSE
          v_pool_subset := 0;
          SELECT count(*)::int INTO v_n
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = p_shift_start_iso
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid));
        END IF;
      END IF;
    END IF;

    IF v_n IS NULL OR v_n <= 0 THEN
      CONTINUE;
    END IF;

    v_share := v_line / v_n::numeric;

    IF NOT v_fallback THEN
      IF v_small AND v_pool_subset > 0 THEN
        FOR wid IN
          SELECT i.workforce_id
          FROM gl_shift_team_membership_interval i
          WHERE i.shift_start_iso = p_shift_start_iso
            AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND i.valid_from <= v_t
            AND (i.valid_to IS NULL OR v_t < i.valid_to)
            AND i.remuneration_pool = 'small_sku'
        LOOP
          INSERT INTO _earn_acc (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_acc.amt + EXCLUDED.amt;
        END LOOP;
      ELSIF v_small AND v_pool_subset = 0 THEN
        FOR wid IN
          SELECT i.workforce_id
          FROM gl_shift_team_membership_interval i
          WHERE i.shift_start_iso = p_shift_start_iso
            AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND i.valid_from <= v_t
            AND (i.valid_to IS NULL OR v_t < i.valid_to)
        LOOP
          INSERT INTO _earn_acc (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_acc.amt + EXCLUDED.amt;
        END LOOP;
      ELSIF NOT v_small AND v_pool_subset > 0 THEN
        FOR wid IN
          SELECT i.workforce_id
          FROM gl_shift_team_membership_interval i
          WHERE i.shift_start_iso = p_shift_start_iso
            AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND i.valid_from <= v_t
            AND (i.valid_to IS NULL OR v_t < i.valid_to)
            AND i.remuneration_pool = 'main'
        LOOP
          INSERT INTO _earn_acc (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_acc.amt + EXCLUDED.amt;
        END LOOP;
      ELSE
        FOR wid IN
          SELECT i.workforce_id
          FROM gl_shift_team_membership_interval i
          WHERE i.shift_start_iso = p_shift_start_iso
            AND lower(trim(i.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND i.valid_from <= v_t
            AND (i.valid_to IS NULL OR v_t < i.valid_to)
        LOOP
          INSERT INTO _earn_acc (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_acc.amt + EXCLUDED.amt;
        END LOOP;
      END IF;
    ELSE
      IF v_small AND v_pool_subset > 0 THEN
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = p_shift_start_iso
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND m.remuneration_pool = 'small_sku'
        LOOP
          INSERT INTO _earn_acc (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_acc.amt + EXCLUDED.amt;
        END LOOP;
      ELSIF v_small AND v_pool_subset = 0 THEN
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = p_shift_start_iso
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
        LOOP
          INSERT INTO _earn_acc (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_acc.amt + EXCLUDED.amt;
        END LOOP;
      ELSIF NOT v_small AND v_pool_subset > 0 THEN
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = p_shift_start_iso
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND m.remuneration_pool = 'main'
        LOOP
          INSERT INTO _earn_acc (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_acc.amt + EXCLUDED.amt;
        END LOOP;
      ELSE
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = p_shift_start_iso
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
        LOOP
          INSERT INTO _earn_acc (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_acc.amt + EXCLUDED.amt;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  RETURN COALESCE(
    (SELECT jsonb_build_object(
      'by_workforce',
      coalesce(jsonb_agg(
        jsonb_build_object(
          'workforce_id', w.id,
          'display_name', w.display_name,
          'total_kes', round(e.amt, 2)
        )
        ORDER BY w.display_name
      ), '[]'::jsonb)
    )
    FROM _earn_acc e
    JOIN prt_workforce_roster w ON w.id = e.workforce_id),
    jsonb_build_object('by_workforce', '[]'::jsonb)
  );
END;
$$;

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
  v_fallback boolean := false;
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

    v_fallback := false;
    IF v_n IS NULL OR v_n <= 0 THEN
      v_fallback := true;
      IF v_small THEN
        SELECT count(*)::int INTO v_pool_subset
        FROM gl_shift_team_member m
        WHERE m.shift_start_iso = v_shift
          AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND m.remuneration_pool = 'small_sku';
        IF v_pool_subset > 0 THEN
          v_n := v_pool_subset;
        ELSE
          v_pool_subset := 0;
          SELECT count(*)::int INTO v_n
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid));
        END IF;
      ELSE
        SELECT count(*)::int INTO v_pool_subset
        FROM gl_shift_team_member m
        WHERE m.shift_start_iso = v_shift
          AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND m.remuneration_pool = 'main';
        IF v_pool_subset > 0 THEN
          v_n := v_pool_subset;
        ELSE
          v_pool_subset := 0;
          SELECT count(*)::int INTO v_n
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid));
        END IF;
      END IF;
    END IF;

    IF v_n IS NULL OR v_n <= 0 THEN
      CONTINUE;
    END IF;

    v_share := v_line / v_n::numeric;

    IF NOT v_fallback THEN
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
    ELSE
      IF v_small AND v_pool_subset > 0 THEN
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND m.remuneration_pool = 'small_sku'
        LOOP
          INSERT INTO _earn_scoped (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_scoped.amt + EXCLUDED.amt;
        END LOOP;
      ELSIF v_small AND v_pool_subset = 0 THEN
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
        LOOP
          INSERT INTO _earn_scoped (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_scoped.amt + EXCLUDED.amt;
        END LOOP;
      ELSIF NOT v_small AND v_pool_subset > 0 THEN
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND m.remuneration_pool = 'main'
        LOOP
          INSERT INTO _earn_scoped (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_scoped.amt + EXCLUDED.amt;
        END LOOP;
      ELSE
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
        LOOP
          INSERT INTO _earn_scoped (workforce_id, amt) VALUES (wid, v_share)
          ON CONFLICT (workforce_id) DO UPDATE SET amt = _earn_scoped.amt + EXCLUDED.amt;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  RETURN COALESCE(
    (SELECT jsonb_build_object(
      'by_workforce',
      coalesce(jsonb_agg(
        jsonb_build_object(
          'workforce_id', w.id,
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
  'Fair piece-rate totals for one leader tickets only; pools + per-ticket shift. Falls back to gl_shift_team_member when no interval covers ticket time so totals match catalogue.';

GRANT EXECUTE ON FUNCTION gl_workforce_earnings_leader_scoped(text, timestamptz, timestamptz) TO anon, authenticated;

CREATE OR REPLACE FUNCTION gl_payroll_report(
  p_ticket_from timestamptz,
  p_ticket_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rticket RECORD;
  v_leader_uid text;
  v_line numeric;
  v_small boolean;
  v_n int;
  v_share numeric;
  wid uuid;
  v_t timestamptz;
  v_pool_subset int;
  v_shift timestamptz;
  v_eat date;
  tickets_json jsonb;
  person_json jsonb;
  v_priced_total numeric;
  v_unpriced int;
  v_ticket_n int;
  v_alloc numeric;
  v_fallback boolean := false;
BEGIN
  IF p_ticket_from IS NULL OR p_ticket_to IS NULL OR p_ticket_to <= p_ticket_from THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'invalid_range',
      'tickets', '[]'::jsonb,
      'by_person_day', '[]'::jsonb,
      'totals', jsonb_build_object()
    );
  END IF;

  CREATE TEMP TABLE _payroll_pd (
    eat_date date NOT NULL,
    workforce_id uuid NOT NULL,
    amt numeric NOT NULL DEFAULT 0,
    PRIMARY KEY (eat_date, workforce_id)
  ) ON COMMIT DROP;

  FOR rticket IN
    WITH enriched AS (
      SELECT
        t.created_at AS t,
        t.serial,
        t.sku,
        t.qty::numeric AS qty,
        COALESCE(NULLIF(trim(t.uom), ''), s.uom) AS uom_raw,
        normalize_banding_payout_uom(COALESCE(NULLIF(trim(t.uom), ''), s.uom)) AS norm_uom,
        t.production_line,
        t.batch_lot,
        t.pallet_color,
        t.group_leader AS gl_name,
        t.recorded_by,
        s.banding_demarcation,
        sku_weight_size_key_from_sachet(s.sachet_type) AS wk
      FROM tickets t
      LEFT JOIN skus s ON s.sku = t.sku
      WHERE coalesce(t.voided, false) = false
        AND t.created_at >= p_ticket_from
        AND t.created_at < p_ticket_to
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
    v_leader_uid := gl_group_leader_user_id_from_name(rticket.gl_name);
    IF v_leader_uid IS NULL THEN
      CONTINUE;
    END IF;
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

    v_fallback := false;
    IF v_n IS NULL OR v_n <= 0 THEN
      v_fallback := true;
      IF v_small THEN
        SELECT count(*)::int INTO v_pool_subset
        FROM gl_shift_team_member m
        WHERE m.shift_start_iso = v_shift
          AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND m.remuneration_pool = 'small_sku';
        IF v_pool_subset > 0 THEN
          v_n := v_pool_subset;
        ELSE
          v_pool_subset := 0;
          SELECT count(*)::int INTO v_n
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid));
        END IF;
      ELSE
        SELECT count(*)::int INTO v_pool_subset
        FROM gl_shift_team_member m
        WHERE m.shift_start_iso = v_shift
          AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
          AND m.remuneration_pool = 'main';
        IF v_pool_subset > 0 THEN
          v_n := v_pool_subset;
        ELSE
          v_pool_subset := 0;
          SELECT count(*)::int INTO v_n
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid));
        END IF;
      END IF;
    END IF;

    IF v_n IS NULL OR v_n <= 0 THEN
      CONTINUE;
    END IF;

    v_share := v_line / v_n::numeric;
    v_eat := (v_t AT TIME ZONE 'Africa/Nairobi')::date;

    IF NOT v_fallback THEN
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
          INSERT INTO _payroll_pd (eat_date, workforce_id, amt) VALUES (v_eat, wid, v_share)
          ON CONFLICT (eat_date, workforce_id)
          DO UPDATE SET amt = _payroll_pd.amt + EXCLUDED.amt;
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
          INSERT INTO _payroll_pd (eat_date, workforce_id, amt) VALUES (v_eat, wid, v_share)
          ON CONFLICT (eat_date, workforce_id)
          DO UPDATE SET amt = _payroll_pd.amt + EXCLUDED.amt;
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
          INSERT INTO _payroll_pd (eat_date, workforce_id, amt) VALUES (v_eat, wid, v_share)
          ON CONFLICT (eat_date, workforce_id)
          DO UPDATE SET amt = _payroll_pd.amt + EXCLUDED.amt;
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
          INSERT INTO _payroll_pd (eat_date, workforce_id, amt) VALUES (v_eat, wid, v_share)
          ON CONFLICT (eat_date, workforce_id)
          DO UPDATE SET amt = _payroll_pd.amt + EXCLUDED.amt;
        END LOOP;
      END IF;
    ELSE
      IF v_small AND v_pool_subset > 0 THEN
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND m.remuneration_pool = 'small_sku'
        LOOP
          INSERT INTO _payroll_pd (eat_date, workforce_id, amt) VALUES (v_eat, wid, v_share)
          ON CONFLICT (eat_date, workforce_id)
          DO UPDATE SET amt = _payroll_pd.amt + EXCLUDED.amt;
        END LOOP;
      ELSIF v_small AND v_pool_subset = 0 THEN
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
        LOOP
          INSERT INTO _payroll_pd (eat_date, workforce_id, amt) VALUES (v_eat, wid, v_share)
          ON CONFLICT (eat_date, workforce_id)
          DO UPDATE SET amt = _payroll_pd.amt + EXCLUDED.amt;
        END LOOP;
      ELSIF NOT v_small AND v_pool_subset > 0 THEN
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
            AND m.remuneration_pool = 'main'
        LOOP
          INSERT INTO _payroll_pd (eat_date, workforce_id, amt) VALUES (v_eat, wid, v_share)
          ON CONFLICT (eat_date, workforce_id)
          DO UPDATE SET amt = _payroll_pd.amt + EXCLUDED.amt;
        END LOOP;
      ELSE
        FOR wid IN
          SELECT m.workforce_id
          FROM gl_shift_team_member m
          WHERE m.shift_start_iso = v_shift
            AND lower(trim(m.group_leader_user_id)) = lower(trim(v_leader_uid))
        LOOP
          INSERT INTO _payroll_pd (eat_date, workforce_id, amt) VALUES (v_eat, wid, v_share)
          ON CONFLICT (eat_date, workforce_id)
          DO UPDATE SET amt = _payroll_pd.amt + EXCLUDED.amt;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'eat_date', d.eat_date::text,
        'workforce_id', d.workforce_id::text,
        'display_name', w.display_name,
        'total_kes', round(d.amt, 2)
      )
      ORDER BY d.eat_date, w.display_name
    ),
    '[]'::jsonb
  )
  INTO person_json
  FROM _payroll_pd d
  JOIN prt_workforce_roster w ON w.id = d.workforce_id;

  WITH enriched AS (
    SELECT
      t.created_at AS t,
      t.serial,
      t.sku,
      t.qty::numeric AS qty,
      COALESCE(NULLIF(trim(t.uom), ''), s.uom) AS uom_raw,
      normalize_banding_payout_uom(COALESCE(NULLIF(trim(t.uom), ''), s.uom)) AS norm_uom,
      t.production_line,
      t.batch_lot,
      t.pallet_color,
      t.group_leader AS gl_name,
      t.recorded_by,
      s.banding_demarcation,
      sku_weight_size_key_from_sachet(s.sachet_type) AS wk
    FROM tickets t
    LEFT JOIN skus s ON s.sku = t.sku
    WHERE coalesce(t.voided, false) = false
      AND t.created_at >= p_ticket_from
      AND t.created_at < p_ticket_to
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
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'eat_date', ((p.t AT TIME ZONE 'Africa/Nairobi')::date)::text,
        'created_eat', to_char(p.t AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI'),
        'shift_start_eat', to_char(prt_shift_start_for_timestamp(p.t) AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI'),
        'serial', p.serial,
        'sku', p.sku,
        'qty', p.qty,
        'uom', p.uom_raw,
        'norm_uom', p.norm_uom,
        'production_line', p.production_line,
        'batch_lot', p.batch_lot,
        'pallet_color', p.pallet_color,
        'group_leader', p.gl_name,
        'recorded_by', p.recorded_by,
        'banding_demarcation', p.banding_demarcation,
        'weight_key', p.wk,
        'rate_kes', p.rate_kes,
        'line_kes', p.line_kes,
        'priced', (p.line_kes IS NOT NULL)
      )
      ORDER BY p.t, p.serial
    ), '[]'::jsonb)
  INTO tickets_json
  FROM priced p;

  WITH enriched AS (
    SELECT
      t.created_at AS t,
      normalize_banding_payout_uom(COALESCE(NULLIF(trim(t.uom), ''), s.uom)) AS norm_uom,
      s.banding_demarcation,
      sku_weight_size_key_from_sachet(s.sachet_type) AS wk,
      t.qty::numeric AS qty
    FROM tickets t
    LEFT JOIN skus s ON s.sku = t.sku
    WHERE coalesce(t.voided, false) = false
      AND t.created_at >= p_ticket_from
      AND t.created_at < p_ticket_to
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
  SELECT
    coalesce(sum(line_kes), 0),
    count(*) FILTER (WHERE line_kes IS NULL)::int,
    count(*)::int
  INTO v_priced_total, v_unpriced, v_ticket_n
  FROM priced;

  SELECT coalesce(sum(amt), 0) INTO v_alloc FROM _payroll_pd;

  RETURN jsonb_build_object(
    'ok', true,
    'tickets', tickets_json,
    'by_person_day', person_json,
    'totals', jsonb_build_object(
      'priced_line_kes_total', round(v_priced_total, 2),
      'allocated_pay_kes_total', round(v_alloc, 2),
      'reconciliation_diff_kes', round(v_priced_total - v_alloc, 2),
      'priced_ticket_count', v_ticket_n - v_unpriced,
      'unpriced_ticket_count', v_unpriced,
      'ticket_row_count', v_ticket_n
    )
  );
END;
$$;