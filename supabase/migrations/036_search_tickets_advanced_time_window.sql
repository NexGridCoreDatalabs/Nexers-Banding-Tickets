-- Extend advanced search RPC with optional timestamp window support.
-- Allows exact "This Shift" filtering without relying only on date boundaries.

DROP FUNCTION IF EXISTS search_tickets_advanced(
  text, date, date, text, text, text, text, boolean, integer
);

CREATE OR REPLACE FUNCTION search_tickets_advanced(
  p_actor_user_id text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_batch_query text DEFAULT NULL,
  p_serial_query text DEFAULT NULL,
  p_sku text DEFAULT NULL,
  p_line text DEFAULT NULL,
  p_include_voided boolean DEFAULT true,
  p_limit integer DEFAULT 500,
  p_start_ts timestamptz DEFAULT NULL,
  p_end_ts timestamptz DEFAULT NULL
)
RETURNS TABLE (
  serial text,
  batch_lot text,
  sku text,
  qty numeric,
  uom text,
  production_line text,
  pallet_color text,
  created_at timestamptz,
  recorded_by text,
  voided boolean,
  voided_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_id text;
  v_start date;
  v_end date;
  v_limit integer;
  v_batch text;
  v_serial text;
  v_sku text;
  v_line text;
  v_privileged boolean;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
BEGIN
  v_actor_id := regexp_replace(upper(trim(coalesce(p_actor_user_id, ''))), '[^A-Z0-9]', '', 'g');
  v_start := coalesce(p_start_date, (now() AT TIME ZONE 'Africa/Nairobi')::date);
  v_end := coalesce(p_end_date, v_start);
  IF v_end < v_start THEN v_end := v_start; END IF;

  v_start_ts := p_start_ts;
  v_end_ts := p_end_ts;
  IF v_start_ts IS NOT NULL AND v_end_ts IS NOT NULL AND v_end_ts < v_start_ts THEN
    v_end_ts := v_start_ts;
  END IF;

  v_limit := GREATEST(1, LEAST(coalesce(p_limit, 500), 1000));
  v_batch := nullif(trim(coalesce(p_batch_query, '')), '');
  v_serial := nullif(trim(coalesce(p_serial_query, '')), '');
  v_sku := nullif(trim(coalesce(p_sku, '')), '');
  v_line := nullif(trim(coalesce(p_line, '')), '');
  v_privileged := (v_actor_id = 'RFXRCVTD101');

  IF v_privileged THEN
    RETURN QUERY
    SELECT
      t.serial, t.batch_lot, t.sku, t.qty, t.uom, t.production_line, t.pallet_color,
      t.created_at, t.recorded_by, t.voided, t.voided_reason
    FROM tickets t
    WHERE (
      (v_start_ts IS NOT NULL AND v_end_ts IS NOT NULL AND t.created_at >= v_start_ts AND t.created_at <= v_end_ts)
      OR
      (v_start_ts IS NULL AND v_end_ts IS NULL AND (t.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN v_start AND v_end)
    )
      AND (v_batch IS NULL OR upper(coalesce(t.batch_lot, '')) LIKE '%' || upper(v_batch) || '%')
      AND (v_serial IS NULL OR upper(coalesce(t.serial, '')) LIKE '%' || upper(v_serial) || '%')
      AND (v_sku IS NULL OR t.sku = v_sku)
      AND (v_line IS NULL OR t.production_line = v_line)
      AND (coalesce(p_include_voided, true) OR coalesce(t.voided, false) = false)
    ORDER BY t.created_at DESC
    LIMIT v_limit;
    RETURN;
  END IF;

  -- Non-privileged guardrails: own tickets only, max 7 days or equivalent.
  IF (v_end - v_start) > 7 THEN v_end := v_start + 7; END IF;
  IF v_start_ts IS NOT NULL AND v_end_ts IS NOT NULL AND v_end_ts > (v_start_ts + interval '7 days') THEN
    v_end_ts := v_start_ts + interval '7 days';
  END IF;

  RETURN QUERY
  SELECT
    t.serial, t.batch_lot, t.sku, t.qty, t.uom, t.production_line, t.pallet_color,
    t.created_at, t.recorded_by, t.voided, t.voided_reason
  FROM tickets t
  WHERE regexp_replace(upper(coalesce(t.recorded_by, '')), '[^A-Z0-9]', '', 'g') = v_actor_id
    AND (
      (v_start_ts IS NOT NULL AND v_end_ts IS NOT NULL AND t.created_at >= v_start_ts AND t.created_at <= v_end_ts)
      OR
      (v_start_ts IS NULL AND v_end_ts IS NULL AND (t.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN v_start AND v_end)
    )
    AND (v_batch IS NULL OR upper(coalesce(t.batch_lot, '')) LIKE '%' || upper(v_batch) || '%')
    AND (v_serial IS NULL OR upper(coalesce(t.serial, '')) LIKE '%' || upper(v_serial) || '%')
    AND (v_sku IS NULL OR t.sku = v_sku)
    AND (v_line IS NULL OR t.production_line = v_line)
    AND (coalesce(p_include_voided, true) OR coalesce(t.voided, false) = false)
  ORDER BY t.created_at DESC
  LIMIT LEAST(v_limit, 500);
END;
$$;

