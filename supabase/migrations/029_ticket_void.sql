-- RetiFlux™ — Ticket void support
-- Adds voided flag + audit columns to tickets.
-- Voided tickets are excluded from all operational queries and WhatsApp reports.
-- Pallets linked to voided tickets are also flagged so zone stock counts stay accurate.

-- ── Tickets ──────────────────────────────────────────────────────────────────

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS voided        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at     timestamptz,
  ADD COLUMN IF NOT EXISTS voided_reason text,
  ADD COLUMN IF NOT EXISTS voided_by     text;

COMMENT ON COLUMN tickets.voided        IS 'True when the clerk has voided this ticket due to a data-entry mistake';
COMMENT ON COLUMN tickets.voided_at     IS 'Timestamp (UTC) when the ticket was voided';
COMMENT ON COLUMN tickets.voided_reason IS 'Mandatory reason entered by the clerk at void time';
COMMENT ON COLUMN tickets.voided_by     IS 'Clerk name (session) who performed the void';

-- Partial index — fast lookup of non-voided tickets (used by all operational queries)
CREATE INDEX IF NOT EXISTS idx_tickets_not_voided
  ON tickets (created_at DESC)
  WHERE voided = false;

-- ── Pallets ───────────────────────────────────────────────────────────────────
-- Pallets created from voided tickets are also marked voided so they are
-- excluded from zone stock counts and FIFO recommendations.

ALTER TABLE pallets
  ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pallets.voided IS 'Mirrors tickets.voided — set true when the source ticket is voided';

CREATE INDEX IF NOT EXISTS idx_pallets_not_voided
  ON pallets (zone_id, created_at DESC)
  WHERE voided = false;

-- ── RLS-friendly void function ────────────────────────────────────────────────
-- Called from the front-end: voids the ticket and its linked pallet atomically.
-- Only works on tickets created today (EAT = UTC+3).

CREATE OR REPLACE FUNCTION void_ticket(
  p_serial        text,
  p_voided_by     text,
  p_voided_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id  uuid;
  v_created_at timestamptz;
  v_today_eat  date;
BEGIN
  -- EAT = UTC+3
  v_today_eat := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  SELECT id, created_at
    INTO v_ticket_id, v_created_at
    FROM tickets
   WHERE serial  = p_serial
     AND voided  = false
   LIMIT 1;

  IF v_ticket_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ticket not found or already voided');
  END IF;

  -- Enforce same-day-only rule (EAT)
  IF (v_created_at AT TIME ZONE 'Africa/Nairobi')::date <> v_today_eat THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ticket can only be voided on the day it was created');
  END IF;

  -- Void the ticket
  UPDATE tickets
     SET voided        = true,
         voided_at     = now(),
         voided_reason = p_voided_reason,
         voided_by     = p_voided_by
   WHERE id = v_ticket_id;

  -- Void the linked pallet
  UPDATE pallets
     SET voided = true
   WHERE original_ticket_serial = p_serial
     AND voided = false;

  RETURN jsonb_build_object('ok', true);
END;
$$;
