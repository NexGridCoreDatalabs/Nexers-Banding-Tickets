-- Fix: json used w.workforce_id but prt_workforce_roster row key is id (alias w).
-- Replaces functions for databases that already applied 047 / 050 with the typo.

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

    IF v_n IS NULL OR v_n <= 0 THEN
      CONTINUE;
    END IF;

    v_share := v_line / v_n::numeric;

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
  'Fair piece-rate totals for one leader tickets only; pools + per-ticket shift start.';

GRANT EXECUTE ON FUNCTION gl_workforce_earnings_leader_scoped(text, timestamptz, timestamptz) TO anon, authenticated;
