-- RetiFlux™ — Ticket listing RPC for void/replace panel
-- Purpose: enforce privileged 30-day access on the database side.

CREATE OR REPLACE FUNCTION list_tickets_for_void(
  p_actor_user_id text,
  p_days integer DEFAULT 30,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  serial text,
  sku text,
  qty numeric,
  uom text,
  pallet_color text,
  created_at timestamptz,
  voided boolean,
  voided_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_id text;
  v_days integer;
  v_limit integer;
BEGIN
  v_actor_id := regexp_replace(upper(trim(coalesce(p_actor_user_id, ''))), '[^A-Z0-9]', '', 'g');
  v_days := GREATEST(1, LEAST(coalesce(p_days, 30), 30));
  v_limit := GREATEST(1, LEAST(coalesce(p_limit, 200), 500));

  -- Explicit allowlist: RFX-RCV-TD-101
  IF v_actor_id = 'RFXRCVTD101' THEN
    RETURN QUERY
    SELECT
      t.serial, t.sku, t.qty, t.uom, t.pallet_color, t.created_at,
      t.voided, t.voided_reason
    FROM tickets t
    WHERE t.created_at >= now() - make_interval(days => v_days)
    ORDER BY t.created_at DESC
    LIMIT v_limit;
    RETURN;
  END IF;

  -- Non-privileged users: own tickets today (EAT), same as current behavior.
  RETURN QUERY
  SELECT
    t.serial, t.sku, t.qty, t.uom, t.pallet_color, t.created_at,
    t.voided, t.voided_reason
  FROM tickets t
  WHERE regexp_replace(upper(coalesce(t.recorded_by, '')), '[^A-Z0-9]', '', 'g') = v_actor_id
    AND (t.created_at AT TIME ZONE 'Africa/Nairobi')::date = (now() AT TIME ZONE 'Africa/Nairobi')::date
  ORDER BY t.created_at DESC
  LIMIT LEAST(v_limit, 50);
END;
$$;

