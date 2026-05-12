-- ─────────────────────────────────────────────────────────────────────────────
-- GL teams: remuneration_pool (main / small_sku), time-bounded membership
-- intervals, transfer requests (accept at server now), roster save RPC.
-- Remuneration summary UI unchanged; fair per-person: gl_workforce_earnings_shift.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE gl_shift_team_member
  ADD COLUMN IF NOT EXISTS remuneration_pool text NOT NULL DEFAULT 'main';

ALTER TABLE gl_shift_team_member
  DROP CONSTRAINT IF EXISTS gl_shift_team_member_remuneration_pool_check;

ALTER TABLE gl_shift_team_member
  ADD CONSTRAINT gl_shift_team_member_remuneration_pool_check
  CHECK (remuneration_pool IN ('main', 'small_sku'));

COMMENT ON COLUMN gl_shift_team_member.remuneration_pool IS
  'Pay pool tag: main vs small_sku (100g/200g KAR + SACK + BUCKET work splits).';

CREATE TABLE IF NOT EXISTS gl_shift_team_membership_interval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_start_iso timestamptz NOT NULL,
  workforce_id uuid NOT NULL REFERENCES prt_workforce_roster(id) ON DELETE CASCADE,
  group_leader_user_id text NOT NULL,
  group_leader_name text NOT NULL,
  remuneration_pool text NOT NULL CHECK (remuneration_pool IN ('main', 'small_sku')),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interval_valid_range CHECK (
    valid_to IS NULL OR valid_to > valid_from
  )
);

CREATE INDEX IF NOT EXISTS gl_membership_interval_shift_workforce_idx
  ON gl_shift_team_membership_interval (shift_start_iso, workforce_id);
CREATE INDEX IF NOT EXISTS gl_membership_interval_shift_leader_time_idx
  ON gl_shift_team_membership_interval (shift_start_iso, group_leader_user_id, valid_from);

COMMENT ON TABLE gl_shift_team_membership_interval IS
  'Half-open [valid_from, valid_to): membership for pay attribution at ticket.created_at.';

CREATE TABLE IF NOT EXISTS gl_team_transfer_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_start_iso timestamptz NOT NULL,
  workforce_id uuid NOT NULL REFERENCES prt_workforce_roster(id) ON DELETE CASCADE,
  from_leader_user_id text NOT NULL,
  to_leader_user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  pool_on_accept text CHECK (pool_on_accept IN ('main', 'small_sku')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT transfer_pool_only_when_resolved CHECK (
    (status = 'accepted' AND pool_on_accept IS NOT NULL)
    OR (status <> 'accepted')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS gl_team_transfer_one_pending_per_person_idx
  ON gl_team_transfer_request (shift_start_iso, workforce_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS gl_team_transfer_to_leader_pending_idx
  ON gl_team_transfer_request (to_leader_user_id, shift_start_iso)
  WHERE status = 'pending';

ALTER TABLE gl_shift_team_membership_interval ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_team_transfer_request ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gl_shift_team_membership_interval_anon_all" ON gl_shift_team_membership_interval;
CREATE POLICY "gl_shift_team_membership_interval_anon_all"
  ON gl_shift_team_membership_interval FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "gl_team_transfer_request_anon_all" ON gl_team_transfer_request;
CREATE POLICY "gl_team_transfer_request_anon_all"
  ON gl_team_transfer_request FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "gl_shift_team_membership_interval_auth_all" ON gl_shift_team_membership_interval;
CREATE POLICY "gl_shift_team_membership_interval_auth_all"
  ON gl_shift_team_membership_interval FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "gl_team_transfer_request_auth_all" ON gl_team_transfer_request;
CREATE POLICY "gl_team_transfer_request_auth_all"
  ON gl_team_transfer_request FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Backfill: one open interval per existing roster row (shift start → open).
INSERT INTO gl_shift_team_membership_interval (
  shift_start_iso, workforce_id, group_leader_user_id, group_leader_name,
  remuneration_pool, valid_from, valid_to
)
SELECT
  m.shift_start_iso,
  m.workforce_id,
  m.group_leader_user_id,
  m.group_leader_name,
  'main',
  m.shift_start_iso,
  NULL
FROM gl_shift_team_member m
WHERE NOT EXISTS (
  SELECT 1 FROM gl_shift_team_membership_interval i
  WHERE i.shift_start_iso = m.shift_start_iso
    AND i.workforce_id = m.workforce_id
    AND i.group_leader_user_id = m.group_leader_user_id
    AND i.valid_to IS NULL
);

-- ── Resolve group_leader display name → authorized_users.user_id ─────────────
CREATE OR REPLACE FUNCTION gl_group_leader_user_id_from_name(p_display_name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT au.user_id::text
  FROM authorized_users au
  WHERE lower(trim(au.name)) = lower(trim(COALESCE(p_display_name, '')))
    AND lower(trim(coalesce(au.role, ''))) = 'group leader'
  ORDER BY au.user_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION gl_close_open_interval(
  p_shift timestamptz,
  p_workforce uuid,
  p_leader_uid text,
  p_until timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE gl_shift_team_membership_interval i
  SET valid_to = CASE
    WHEN i.valid_from >= p_until THEN i.valid_from + interval '1 microsecond'
    ELSE p_until
  END
  WHERE i.shift_start_iso = p_shift
    AND i.workforce_id = p_workforce
    AND lower(trim(i.group_leader_user_id)) = lower(trim(p_leader_uid))
    AND i.valid_to IS NULL;
$$;

-- Save roster + sync intervals (replace client delete/insert).
CREATE OR REPLACE FUNCTION gl_save_shift_roster(
  p_shift_start_iso timestamptz,
  p_leader_user_id text,
  p_leader_name text,
  p_members jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_uid text := trim(lower(COALESCE(p_leader_user_id, '')));
  v_name text := trim(COALESCE(p_leader_name, ''));
  rec RECORD;
  v_wid uuid;
  v_pool text;
  v_has_history boolean;
  v_start timestamptz;
  r_mem public.gl_shift_team_member%ROWTYPE;
BEGIN
  IF v_uid = '' OR v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'leader_required');
  END IF;

  IF p_members IS NULL OR jsonb_typeof(p_members) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'members_must_be_array');
  END IF;

  CREATE TEMP TABLE _save_new (workforce_id uuid PRIMARY KEY, pool text NOT NULL)
    ON COMMIT DROP;
  FOR rec IN SELECT elem FROM jsonb_array_elements(p_members) AS j(elem)
  LOOP
    v_wid := (rec.elem->>'workforce_id')::uuid;
    v_pool := lower(trim(coalesce(rec.elem->>'pool', 'main')));
    IF v_pool NOT IN ('main', 'small_sku') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_pool');
    END IF;
    INSERT INTO _save_new (workforce_id, pool) VALUES (v_wid, v_pool)
    ON CONFLICT (workforce_id) DO UPDATE SET pool = EXCLUDED.pool;
  END LOOP;

  -- Block if any new member is on another leader (unless transfer completed separately).
  IF EXISTS (
    SELECT 1 FROM _save_new n
    JOIN gl_shift_team_member m
      ON m.shift_start_iso = p_shift_start_iso
     AND m.workforce_id = n.workforce_id
     AND lower(trim(m.group_leader_user_id)) <> v_uid
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error',
      'one_or_more_members_on_another_team_use_transfer'
    );
  END IF;

  -- Removed from roster
  FOR r_mem IN
    SELECT m.* FROM gl_shift_team_member m
    WHERE m.shift_start_iso = p_shift_start_iso
      AND lower(trim(m.group_leader_user_id)) = v_uid
      AND NOT EXISTS (SELECT 1 FROM _save_new n WHERE n.workforce_id = m.workforce_id)
  LOOP
    PERFORM gl_close_open_interval(p_shift_start_iso, r_mem.workforce_id, p_leader_user_id, v_now);
    DELETE FROM gl_shift_team_member
    WHERE id = r_mem.id;
  END LOOP;

  -- Added to roster
  FOR rec IN SELECT n.* FROM _save_new n
    WHERE NOT EXISTS (
      SELECT 1 FROM gl_shift_team_member m
      WHERE m.shift_start_iso = p_shift_start_iso
        AND m.workforce_id = n.workforce_id
        AND lower(trim(m.group_leader_user_id)) = v_uid
    )
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM gl_shift_team_membership_interval i
      WHERE i.shift_start_iso = p_shift_start_iso
        AND i.workforce_id = rec.workforce_id
    ) INTO v_has_history;
    IF v_has_history THEN
      v_start := v_now;
    ELSE
      v_start := p_shift_start_iso;
    END IF;
    INSERT INTO gl_shift_team_member (
      shift_start_iso, group_leader_user_id, group_leader_name, workforce_id, remuneration_pool
    ) VALUES (
      p_shift_start_iso, p_leader_user_id, v_name, rec.workforce_id, rec.pool
    );
    INSERT INTO gl_shift_team_membership_interval (
      shift_start_iso, workforce_id, group_leader_user_id, group_leader_name,
      remuneration_pool, valid_from, valid_to
    ) VALUES (
      p_shift_start_iso, rec.workforce_id, p_leader_user_id, v_name, rec.pool, v_start, NULL
    );
  END LOOP;

  -- Still on roster: pool change?
  FOR rec IN
    SELECT n.workforce_id, n.pool AS new_pool, m.remuneration_pool AS old_pool, m.id AS mid
    FROM _save_new n
    JOIN gl_shift_team_member m
      ON m.shift_start_iso = p_shift_start_iso
     AND m.workforce_id = n.workforce_id
     AND lower(trim(m.group_leader_user_id)) = v_uid
    WHERE n.pool IS DISTINCT FROM m.remuneration_pool
  LOOP
    PERFORM gl_close_open_interval(p_shift_start_iso, rec.workforce_id, p_leader_user_id, v_now);
    UPDATE gl_shift_team_member
    SET remuneration_pool = rec.new_pool
    WHERE id = rec.mid;
    INSERT INTO gl_shift_team_membership_interval (
      shift_start_iso, workforce_id, group_leader_user_id, group_leader_name,
      remuneration_pool, valid_from, valid_to
    ) VALUES (
      p_shift_start_iso, rec.workforce_id, p_leader_user_id, v_name, rec.new_pool, v_now, NULL
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION gl_team_transfer_request_create(
  p_shift_start_iso timestamptz,
  p_from_leader_user_id text,
  p_to_leader_user_id text,
  p_workforce_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from text := trim(lower(COALESCE(p_from_leader_user_id, '')));
  v_to text := trim(lower(COALESCE(p_to_leader_user_id, '')));
  v_id uuid;
BEGIN
  IF v_from = '' OR v_to = '' OR v_from = v_to THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_leaders');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM gl_shift_team_member m
    WHERE m.shift_start_iso = p_shift_start_iso
      AND m.workforce_id = p_workforce_id
      AND lower(trim(m.group_leader_user_id)) = lower(trim(p_from_leader_user_id))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'member_not_on_your_team');
  END IF;
  IF EXISTS (
    SELECT 1 FROM gl_team_transfer_request r
    WHERE r.shift_start_iso = p_shift_start_iso
      AND r.workforce_id = p_workforce_id
      AND r.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_transfer_exists');
  END IF;
  INSERT INTO gl_team_transfer_request (
    shift_start_iso, workforce_id, from_leader_user_id, to_leader_user_id, status
  ) VALUES (
    p_shift_start_iso, p_workforce_id, p_from_leader_user_id, p_to_leader_user_id, 'pending'
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'request_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION gl_team_transfer_request_cancel(
  p_request_id uuid,
  p_from_leader_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from text := trim(lower(COALESCE(p_from_leader_user_id, '')));
BEGIN
  UPDATE gl_team_transfer_request r
  SET status = 'cancelled', resolved_at = clock_timestamp()
  WHERE r.id = p_request_id
    AND r.status = 'pending'
    AND lower(trim(r.from_leader_user_id)) = v_from;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_not_pending');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION gl_team_transfer_request_respond(
  p_request_id uuid,
  p_to_leader_user_id text,
  p_accept boolean,
  p_pool text DEFAULT 'main'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to text := trim(lower(COALESCE(p_to_leader_user_id, '')));
  v_pool text := lower(trim(coalesce(p_pool, 'main')));
  v_now timestamptz := clock_timestamp();
  r gl_team_transfer_request%ROWTYPE;
  v_to_name text;
BEGIN
  IF v_pool NOT IN ('main', 'small_sku') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pool');
  END IF;
  SELECT * INTO r FROM gl_team_transfer_request tr
  WHERE tr.id = p_request_id AND tr.status = 'pending'
    AND lower(trim(tr.to_leader_user_id)) = v_to;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_not_pending');
  END IF;
  IF NOT p_accept THEN
    UPDATE gl_team_transfer_request
    SET status = 'rejected', resolved_at = v_now
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;
  SELECT trim(coalesce(name, user_id)) INTO v_to_name
  FROM authorized_users
  WHERE lower(trim(user_id)) = v_to
  LIMIT 1;
  IF v_to_name IS NULL OR v_to_name = '' THEN
    v_to_name := p_to_leader_user_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM gl_shift_team_member m
    WHERE m.shift_start_iso = r.shift_start_iso
      AND m.workforce_id = r.workforce_id
      AND lower(trim(m.group_leader_user_id)) <> lower(trim(r.from_leader_user_id))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'member_conflict_refresh');
  END IF;

  PERFORM gl_close_open_interval(
    r.shift_start_iso, r.workforce_id, r.from_leader_user_id, v_now
  );
  DELETE FROM gl_shift_team_member
  WHERE shift_start_iso = r.shift_start_iso
    AND workforce_id = r.workforce_id
    AND lower(trim(group_leader_user_id)) = lower(trim(r.from_leader_user_id));

  INSERT INTO gl_shift_team_member (
    shift_start_iso, group_leader_user_id, group_leader_name, workforce_id, remuneration_pool
  ) VALUES (
    r.shift_start_iso, p_to_leader_user_id, v_to_name, r.workforce_id, v_pool
  );
  INSERT INTO gl_shift_team_membership_interval (
    shift_start_iso, workforce_id, group_leader_user_id, group_leader_name,
    remuneration_pool, valid_from, valid_to
  ) VALUES (
    r.shift_start_iso, r.workforce_id, p_to_leader_user_id, v_to_name, v_pool, v_now, NULL
  );

  UPDATE gl_team_transfer_request
  SET status = 'accepted', pool_on_accept = v_pool, resolved_at = v_now
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'status', 'accepted');
END;
$$;

-- Ticket is "small bucket" for pay split (100g/200g KAR or SACK/BUCKET UOM).
CREATE OR REPLACE FUNCTION gl_ticket_is_small_sku_bucket(
  p_wk text,
  p_norm_uom text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (
    (p_wk IN ('100G', '200G') AND COALESCE(p_norm_uom, '') = 'KAR')
    OR COALESCE(p_norm_uom, '') IN ('SACK', 'BUCKET')
  );
$$;

-- Fair per-person totals for shift (all leaders), ticket-time intervals.
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

COMMENT ON FUNCTION gl_shift_remuneration_summary(text, text, timestamptz, timestamptz, timestamptz) IS
  'Leader scoped pay snapshot (group totals). kes_per_person is approximate when pools/transfers exist; use gl_workforce_earnings_shift for fair splits.';

GRANT EXECUTE ON FUNCTION gl_group_leader_user_id_from_name(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gl_close_open_interval(timestamptz, uuid, text, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gl_save_shift_roster(timestamptz, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gl_team_transfer_request_create(timestamptz, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gl_team_transfer_request_cancel(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gl_team_transfer_request_respond(uuid, text, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gl_ticket_is_small_sku_bucket(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gl_workforce_earnings_shift(timestamptz, timestamptz, timestamptz) TO anon, authenticated;
