-- RetiFlux™ Stock Movement — Supabase backend
-- Run in Supabase SQL Editor
-- Replaces GAS for: getZoneConfig, getPalletsInZone, getInboundsToZone, getOutboundsFromZone, movePallet, receivePallet
--
-- Prerequisite: zone_config must be seeded (run seed/001_zone_config.sql or RUN_SEED_ONLY.sql)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Zone config (read) — already in zone_config table
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Movement ID generator
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_movement_id()
RETURNS text AS $$
  SELECT 'MOV-' || to_char(now(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 10000)::text, 4, '0');
$$ LANGUAGE sql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Initiate move (pallet → in transit)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION movement_initiate(
  p_pallet_id text,
  p_to_zone text,
  p_moved_by text,
  p_reason text DEFAULT '',
  p_override_reason text DEFAULT '',
  p_quantity numeric DEFAULT NULL,
  p_order_reference text DEFAULT ''
)
RETURNS jsonb AS $$
DECLARE
  v_pallet pallets%ROWTYPE;
  v_movement_id text;
  v_qty numeric;
BEGIN
  IF NULLIF(trim(p_pallet_id), '') IS NULL OR NULLIF(trim(p_to_zone), '') IS NULL OR NULLIF(trim(p_moved_by), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing palletId, toZone, or movedBy');
  END IF;

  SELECT * INTO v_pallet FROM pallets WHERE pallet_id = p_pallet_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet not found: ' || p_pallet_id);
  END IF;

  IF v_pallet.in_transit_to_zone IS NOT NULL AND trim(v_pallet.in_transit_to_zone) != '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet is already in transit to ' || v_pallet.in_transit_to_zone);
  END IF;

  IF v_pallet.current_zone = p_to_zone THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet is already in ' || p_to_zone);
  END IF;

  v_qty := COALESCE(p_quantity, v_pallet.remaining_quantity, v_pallet.quantity);
  v_movement_id := generate_movement_id();

  INSERT INTO zone_movements (
    movement_id, pallet_id, from_zone, to_zone,
    movement_date, movement_time, moved_by, reason, override_reason,
    quantity, order_reference, movement_status
  ) VALUES (
    v_movement_id, p_pallet_id, v_pallet.current_zone, p_to_zone,
    current_date, current_time, p_moved_by, NULLIF(trim(p_reason), ''), NULLIF(trim(p_override_reason), ''),
    v_qty, NULLIF(trim(p_order_reference), ''), 'In Transit'
  );

  UPDATE pallets SET
    in_transit_to_zone = p_to_zone,
    in_transit_movement_id = v_movement_id,
    in_transit_initiated_at = now(),
    in_transit_initiated_by = p_moved_by,
    notes = CASE WHEN trim(p_reason) != '' THEN COALESCE(notes || E'\n', '') || '[Initiate] ' || p_reason ELSE notes END
  WHERE pallet_id = p_pallet_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Move initiated to ' || p_to_zone,
    'movementId', v_movement_id,
    'fromZone', v_pallet.current_zone
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Receive pallet (complete transit)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION movement_receive(
  p_pallet_id text,
  p_received_by text
)
RETURNS jsonb AS $$
DECLARE
  v_pallet pallets%ROWTYPE;
  v_to_zone text;
BEGIN
  IF NULLIF(trim(p_pallet_id), '') IS NULL OR NULLIF(trim(p_received_by), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing palletId or receivedBy');
  END IF;

  SELECT * INTO v_pallet FROM pallets WHERE pallet_id = p_pallet_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet not found: ' || p_pallet_id);
  END IF;

  v_to_zone := NULLIF(trim(v_pallet.in_transit_to_zone), '');
  IF v_to_zone IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pallet is not in transit. Nothing to receive.');
  END IF;

  UPDATE pallets SET
    current_zone = v_to_zone,
    in_transit_to_zone = NULL,
    in_transit_movement_id = NULL,
    in_transit_initiated_at = NULL,
    in_transit_initiated_by = NULL,
    last_moved_at = now(),
    last_moved_by = p_received_by
  WHERE pallet_id = p_pallet_id;

  UPDATE zone_movements SET
    movement_status = 'Received',
    received_at = now(),
    received_by = p_received_by
  WHERE pallet_id = p_pallet_id AND movement_status = 'In Transit';

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Pallet received at ' || v_to_zone,
    'palletId', p_pallet_id,
    'fromZone', v_pallet.current_zone,
    'toZone', v_to_zone
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Auto-revert in-transit pallets (15 min timeout)
-- Call via pg_cron every 2–5 min, or external scheduler
-- Total window: 15 min from initiate → pallet reverts to origin
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION movement_auto_revert()
RETURNS jsonb AS $$
DECLARE
  v_cutoff timestamptz;
  v_pallet pallets%ROWTYPE;
  v_reverted jsonb := '[]'::jsonb;
  v_count int := 0;
BEGIN
  v_cutoff := now() - interval '15 minutes';

  FOR v_pallet IN
    SELECT * FROM pallets
    WHERE in_transit_to_zone IS NOT NULL
      AND trim(in_transit_to_zone) != ''
      AND (in_transit_initiated_at IS NULL OR in_transit_initiated_at < v_cutoff)
  LOOP
    -- Clear in-transit on pallet (stays at current_zone)
    UPDATE pallets SET
      in_transit_to_zone = NULL,
      in_transit_movement_id = NULL,
      in_transit_initiated_at = NULL,
      in_transit_initiated_by = NULL,
      notes = CASE WHEN trim(COALESCE(notes, '')) != '' THEN notes || E'\n' ELSE '' END || '[Auto-Revert] In transit > 15 min - reverted to ' || v_pallet.current_zone
    WHERE pallet_id = v_pallet.pallet_id;

    -- Mark movement as auto-reverted
    UPDATE zone_movements SET
      movement_status = 'Auto-Reverted',
      auto_reverted_at = now()
    WHERE pallet_id = v_pallet.pallet_id
      AND movement_status = 'In Transit';

    v_reverted := v_reverted || jsonb_build_object(
      'palletId', v_pallet.pallet_id,
      'fromZone', v_pallet.current_zone,
      'toZone', v_pallet.in_transit_to_zone
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reverted', v_count,
    'pallets', v_reverted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS: allow anon to read pallets, zone_movements, zone_config
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pallets_anon_select" ON pallets;
CREATE POLICY "pallets_anon_select" ON pallets FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "zone_movements_anon_select" ON zone_movements;
CREATE POLICY "zone_movements_anon_select" ON zone_movements FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "zone_config_anon_select" ON zone_config;
CREATE POLICY "zone_config_anon_select" ON zone_config FOR SELECT TO anon USING (true);

-- zone_transitions: allow anon to read (for getAllowedDestinations / suggested locations)
-- Run 002_zone_transitions.sql or RUN_SEED_ONLY.sql if zone_transitions is missing
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'zone_transitions') THEN
    ALTER TABLE zone_transitions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "zone_transitions_anon_select" ON zone_transitions;
    CREATE POLICY "zone_transitions_anon_select" ON zone_transitions FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Grant execute on RPCs to anon
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION movement_initiate(text, text, text, text, text, numeric, text) TO anon;
GRANT EXECUTE ON FUNCTION movement_receive(text, text) TO anon;
GRANT EXECUTE ON FUNCTION movement_auto_revert() TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Index for View All Zones (max performance at 250+ concurrent users)
-- Speeds up: SELECT ... FROM pallets WHERE current_zone IN (...) AND in_transit_to_zone IS NULL
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS pallets_zone_overview_idx
  ON pallets(current_zone)
  WHERE in_transit_to_zone IS NULL;
