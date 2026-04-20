-- RetiFlux™ — Downtime Events & Shift Handover Notes
-- Migration 033
--
-- downtime_events   : clerk-logged gap explanations, triggered per-line idle threshold
-- shift_handover_notes : one note per shift, logged by first clerk to open the PRT form
--
-- Per-line idle thresholds (minutes — enforced in the front-end):
--   PKN: 15  |  MB-250: 20  |  SP: 25  |  Offline Banding: 30
--   AL: 45   |  MB-150: 60

-- ── downtime_events ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS downtime_events (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  production_line      text        NOT NULL,
  shift                text        NOT NULL,   -- 'day' | 'night'
  shift_date           date        NOT NULL,   -- EAT date of the shift
  gap_start            timestamptz NOT NULL,   -- UTC timestamp of last ticket before gap
                                               -- (= shift start time for shift-start delays)
  gap_end              timestamptz NOT NULL,   -- UTC timestamp when event was logged
  gap_minutes          integer     NOT NULL,
  is_shift_start_delay boolean     NOT NULL DEFAULT false,
  category             text        NOT NULL,   -- Machine|Material|Manpower|Method|Management
  sub_category         text        NOT NULL,
  description          text,                  -- clerk's free-text explanation
  logged_by            text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_downtime_line_date
  ON downtime_events (production_line, shift_date, shift);
CREATE INDEX IF NOT EXISTS idx_downtime_gap_start
  ON downtime_events (production_line, gap_start);

COMMENT ON TABLE downtime_events IS
  'Clerk-logged explanations for idle gaps on production lines, triggered automatically when gap exceeds the per-line threshold.';
COMMENT ON COLUMN downtime_events.gap_start IS
  'Timestamp of the last ticket before the gap, or shift start time for shift-start delays.';
COMMENT ON COLUMN downtime_events.is_shift_start_delay IS
  'True when this event covers the period from shift start to the first ticket of the shift.';

-- ── shift_handover_notes ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shift_handover_notes (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date           date        NOT NULL,
  shift                text        NOT NULL,   -- 'day' | 'night'
  outgoing_supervisor  text,
  incoming_supervisor  text,
  note                 text        NOT NULL,
  outstanding_issues   text,
  logged_by            text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_date, shift)                   -- one handover per shift
);

CREATE INDEX IF NOT EXISTS idx_handover_shift_date
  ON shift_handover_notes (shift_date, shift);

COMMENT ON TABLE shift_handover_notes IS
  'One handover note per shift, submitted by the first clerk to open the PRT form at shift start. Included verbatim in the EOS Excel Intelligence Narrative.';

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE downtime_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_handover_notes ENABLE ROW LEVEL SECURITY;

-- Anon can read (reports + form deduplication checks)
DROP POLICY IF EXISTS "downtime_anon_select"   ON downtime_events;
DROP POLICY IF EXISTS "handover_anon_select"   ON shift_handover_notes;
CREATE POLICY "downtime_anon_select"
  ON downtime_events    FOR SELECT TO anon USING (true);
CREATE POLICY "handover_anon_select"
  ON shift_handover_notes FOR SELECT TO anon USING (true);

-- Anon can insert (clerk form submits without auth)
DROP POLICY IF EXISTS "downtime_anon_insert"   ON downtime_events;
DROP POLICY IF EXISTS "handover_anon_insert"   ON shift_handover_notes;
CREATE POLICY "downtime_anon_insert"
  ON downtime_events    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "handover_anon_insert"
  ON shift_handover_notes FOR INSERT TO anon WITH CHECK (true);

-- ── RPC: check_line_gap ───────────────────────────────────────────────────────
-- Called when a clerk selects a production line.
-- Returns:
--   gap_minutes        : how long since last ticket on this line this shift (or since shift start)
--   last_ticket_at     : UTC timestamp of last ticket (null = no tickets this shift)
--   is_shift_start     : true if this would be the first ticket of the shift
--   already_logged     : true if a downtime event already covers this gap
--   logged_by          : who already logged it (if already_logged)
--   last_sku           : SKU of the last ticket (useful for changeover pre-fill)

CREATE OR REPLACE FUNCTION check_line_gap(
  p_line  text,
  p_now   timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_eat            timestamp;        -- timestamp WITHOUT timezone (EAT local clock)
  v_eat_hour       integer;
  v_shift          text;
  v_shift_start    timestamptz;      -- UTC anchor for shift start
  v_shift_date     date;
  v_last_ticket    timestamptz;
  v_last_sku       text;
  v_gap_start      timestamptz;
  v_gap_mins       integer;
  v_is_shift_start boolean;
  v_already_logged boolean;
  v_logged_by      text;
BEGIN
  -- Determine current shift in EAT (UTC+3)
  v_eat      := p_now AT TIME ZONE 'Africa/Nairobi';
  v_eat_hour := EXTRACT(HOUR FROM v_eat);
  v_shift    := CASE WHEN v_eat_hour >= 7 AND v_eat_hour < 19 THEN 'day' ELSE 'night' END;
  v_shift_date := v_eat::date;

  -- Shift start in UTC
  IF v_shift = 'day' THEN
    -- 07:00 EAT = 04:00 UTC same day
    v_shift_start := (date_trunc('day', v_eat) + interval '7 hours') AT TIME ZONE 'Africa/Nairobi';
  ELSE
    -- 19:00 EAT — may be previous UTC day
    v_shift_start := (date_trunc('day', v_eat) + interval '19 hours') AT TIME ZONE 'Africa/Nairobi';
    -- If current hour < 7 EAT, night shift started yesterday evening
    IF v_eat_hour < 7 THEN
      v_shift_start := v_shift_start - interval '1 day';
    END IF;
  END IF;

  -- Last ticket on this line within the current shift
  SELECT created_at, sku
    INTO v_last_ticket, v_last_sku
    FROM tickets
   WHERE production_line = p_line
     AND voided = false
     AND created_at >= v_shift_start
     AND created_at <= p_now
   ORDER BY created_at DESC
   LIMIT 1;

  v_is_shift_start := (v_last_ticket IS NULL);
  v_gap_start      := COALESCE(v_last_ticket, v_shift_start);
  v_gap_mins       := EXTRACT(EPOCH FROM (p_now - v_gap_start))::integer / 60;

  -- Check if a downtime event already covers this gap on this line
  SELECT EXISTS(
    SELECT 1 FROM downtime_events
     WHERE production_line = p_line
       AND gap_start = v_gap_start
  ) INTO v_already_logged;

  IF v_already_logged THEN
    SELECT logged_by INTO v_logged_by
      FROM downtime_events
     WHERE production_line = p_line
       AND gap_start = v_gap_start
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'gap_minutes',     v_gap_mins,
    'last_ticket_at',  v_last_ticket,
    'is_shift_start',  v_is_shift_start,
    'shift',           v_shift,
    'shift_date',      v_shift_date,
    'shift_start',     v_shift_start,
    'already_logged',  COALESCE(v_already_logged, false),
    'logged_by',       v_logged_by,
    'last_sku',        v_last_sku
  );
END;
$$;

-- ── RPC: log_downtime_event ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_downtime_event(
  p_line           text,
  p_shift          text,
  p_shift_date     date,
  p_gap_start      timestamptz,
  p_gap_end        timestamptz,
  p_gap_minutes    integer,
  p_is_shift_start boolean,
  p_category       text,
  p_sub_category   text,
  p_description    text,
  p_logged_by      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Idempotent: if already logged for this gap, return existing id
  IF EXISTS (
    SELECT 1 FROM downtime_events
     WHERE production_line = p_line
       AND gap_start       = p_gap_start
  ) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  INSERT INTO downtime_events (
    production_line, shift, shift_date, gap_start, gap_end,
    gap_minutes, is_shift_start_delay, category, sub_category,
    description, logged_by
  ) VALUES (
    p_line, p_shift, p_shift_date, p_gap_start, p_gap_end,
    p_gap_minutes, p_is_shift_start, p_category, p_sub_category,
    p_description, p_logged_by
  );

  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END;
$$;

-- ── RPC: check_shift_handover ─────────────────────────────────────────────────
-- Returns whether a handover note exists for the current shift,
-- and whether this is the first ticket of the shift (trigger condition).

CREATE OR REPLACE FUNCTION check_shift_handover(
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_eat            timestamp;        -- timestamp WITHOUT timezone (EAT local clock)
  v_eat_hour       integer;
  v_shift          text;
  v_shift_date     date;
  v_shift_start    timestamptz;      -- UTC anchor for shift start
  v_handover_done  boolean;
  v_first_ticket   boolean;
BEGIN
  v_eat      := p_now AT TIME ZONE 'Africa/Nairobi';
  v_eat_hour := EXTRACT(HOUR FROM v_eat);
  v_shift    := CASE WHEN v_eat_hour >= 7 AND v_eat_hour < 19 THEN 'day' ELSE 'night' END;
  v_shift_date := v_eat::date;

  IF v_shift = 'day' THEN
    v_shift_start := (date_trunc('day', v_eat) + interval '7 hours') AT TIME ZONE 'Africa/Nairobi';
  ELSE
    v_shift_start := (date_trunc('day', v_eat) + interval '19 hours') AT TIME ZONE 'Africa/Nairobi';
    IF v_eat_hour < 7 THEN
      v_shift_start := v_shift_start - interval '1 day';
    END IF;
  END IF;

  -- Has a handover note been submitted for this shift already?
  SELECT EXISTS(
    SELECT 1 FROM shift_handover_notes
     WHERE shift_date = v_shift_date AND shift = v_shift
  ) INTO v_handover_done;

  -- Are there ANY tickets at all since shift start?
  SELECT NOT EXISTS(
    SELECT 1 FROM tickets
     WHERE voided = false
       AND created_at >= v_shift_start
       AND created_at <= p_now
  ) INTO v_first_ticket;

  RETURN jsonb_build_object(
    'needs_handover', (v_first_ticket AND NOT v_handover_done),
    'handover_done',  v_handover_done,
    'shift',          v_shift,
    'shift_date',     v_shift_date,
    'shift_label',    CASE WHEN v_shift='day' THEN 'Day Shift  07:00–19:00' ELSE 'Night Shift  19:00–07:00' END
  );
END;
$$;

-- ── RPC: log_shift_handover ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_shift_handover(
  p_shift_date          date,
  p_shift               text,
  p_outgoing_supervisor text,
  p_incoming_supervisor text,
  p_note                text,
  p_outstanding_issues  text,
  p_logged_by           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO shift_handover_notes (
    shift_date, shift, outgoing_supervisor, incoming_supervisor,
    note, outstanding_issues, logged_by
  ) VALUES (
    p_shift_date, p_shift, p_outgoing_supervisor, p_incoming_supervisor,
    p_note, p_outstanding_issues, p_logged_by
  )
  ON CONFLICT (shift_date, shift) DO NOTHING;  -- first one wins

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── Verify ────────────────────────────────────────────────────────────────────

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('downtime_events','shift_handover_notes')
ORDER BY table_name;
