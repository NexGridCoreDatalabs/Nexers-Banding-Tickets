-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: "invalid input syntax for type uuid: SM-20260317-02533"
-- ═══════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE: Client sends correct UUID, but error happens INSIDE the DB.
-- FIX: Full pre-allocation with concurrency safety.
-- - Public `check_order_availability(text)` resolves UUID/external/pallet_id
-- - Internal `check_order_availability_alloc(uuid)` does allocation with locks:
--   advisory per-order lock + `FOR UPDATE SKIP LOCKED` on pallets
--
-- STEPS:
-- 1. Go to https://supabase.com/dashboard → Your Project (dxlsuirjfpcycwurntgs)
-- 2. SQL Editor → New query
-- 3. Paste this ENTIRE file and RUN
-- 4. After run: Project Settings → API → "Reload schema" (or wait ~1 min)
--
-- SUCCESS: Verify table shows check_order_availability(p_order_id text) - NOT uuid
--
-- If error STILL persists: run this diagnostic first to check for bad data:
--   SELECT id, order_id, order_id::text, pallet_id FROM pallet_reservations LIMIT 20;
--   (If that fails, order_id column may have corrupt values)
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop ALL versions (use CASCADE in case of dependencies)
-- CRITICAL: Must drop uuid version first - PostgREST may prefer it and cause "SM-xxx" errors
DROP FUNCTION IF EXISTS check_order_availability(text) CASCADE;
DROP FUNCTION IF EXISTS check_order_availability(uuid) CASCADE;
DROP FUNCTION IF EXISTS check_order_availability_impl(uuid) CASCADE;
DROP FUNCTION IF EXISTS check_order_availability_uuid(uuid) CASCADE;
DROP FUNCTION IF EXISTS check_order_availability_alloc(uuid) CASCADE;

DROP FUNCTION IF EXISTS release_pallet_reservations(text) CASCADE;
DROP FUNCTION IF EXISTS release_pallet_reservations(uuid) CASCADE;
DROP FUNCTION IF EXISTS release_pallet_reservations_impl(uuid) CASCADE;
DROP FUNCTION IF EXISTS release_pallet_reservations_uuid(uuid) CASCADE;
DROP FUNCTION IF EXISTS push_order_to_dispatch(text, text) CASCADE;
DROP FUNCTION IF EXISTS push_order_to_dispatch(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS release_order_pallet(text, text, text) CASCADE;
DROP FUNCTION IF EXISTS release_order_pallet(uuid, text, text) CASCADE;

-- Internal allocator (uuid only)
CREATE OR REPLACE FUNCTION check_order_availability_alloc(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  v_sm_qty numeric;
  v_alloc_from_sm numeric;
  v_remaining numeric;
  v_home_zone text;
  v_pallet_size numeric;
  v_full_pallets int;
  v_partial_units numeric;
  v_task_id text;
  v_tasks jsonb := '[]'::jsonb;
  v_can_release boolean := true;
  v_priority int := 10;
  v_reserved_pallet_id text;
  v_take numeric;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order ID is required';
  END IF;

  -- Serialize per-order allocation under concurrency
  PERFORM pg_advisory_xact_lock(hashtext('check_order_availability:' || p_order_id::text));

  FOR r IN
    SELECT ol.id, ol.item_code, ol.quantity, ol.status
    FROM order_lines ol
    WHERE ol.order_id = p_order_id AND ol.status = 'OPEN'
  LOOP
    v_sm_qty := get_available_sm_qty_for_order(r.item_code, p_order_id);
    v_alloc_from_sm := LEAST(r.quantity, v_sm_qty);
    v_remaining := r.quantity - v_alloc_from_sm;

    WHILE v_alloc_from_sm > 0 LOOP
      SELECT p.pallet_id, LEAST(v_alloc_from_sm, COALESCE(p.remaining_quantity, p.quantity, 0)) AS take_qty
      INTO v_reserved_pallet_id, v_take
      FROM pallets p
      WHERE p.sku = r.item_code
        AND p.current_zone = 'SuperMarket Area'
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
        AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        AND p.pallet_id NOT IN (SELECT pr.pallet_id FROM pallet_reservations pr WHERE pr.released_at IS NULL)
      ORDER BY p.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1;

      EXIT WHEN v_reserved_pallet_id IS NULL OR v_take IS NULL OR v_take <= 0;

      INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
      VALUES (p_order_id, r.id, v_reserved_pallet_id, v_take, 'SM_PICK')
      ON CONFLICT (order_id, order_line_id, pallet_id) DO NOTHING;

      v_alloc_from_sm := v_alloc_from_sm - v_take;
    END LOOP;

    IF v_remaining <= 0 THEN
      CONTINUE;
    END IF;

    SELECT home_zone INTO v_home_zone FROM skus WHERE sku = r.item_code AND is_active = true LIMIT 1;
    IF v_home_zone IS NULL THEN
      UPDATE order_lines SET status = 'SHORT', short_quantity = r.quantity WHERE id = r.id;
      v_can_release := false;
      CONTINUE;
    END IF;

    SELECT p.quantity INTO v_pallet_size
    FROM pallets p
    WHERE p.sku = r.item_code
      AND p.current_zone = v_home_zone
      AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
      AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
      AND p.pallet_id NOT IN (SELECT pr.pallet_id FROM pallet_reservations pr WHERE pr.released_at IS NULL)
    ORDER BY p.created_at ASC
    LIMIT 1;

    IF v_pallet_size IS NULL OR v_pallet_size <= 0 THEN
      UPDATE order_lines SET status = 'SHORT', short_quantity = r.quantity WHERE id = r.id;
      v_can_release := false;
      CONTINUE;
    END IF;

    v_full_pallets := FLOOR(v_remaining / v_pallet_size)::int;
    v_partial_units := v_remaining - (v_full_pallets * v_pallet_size);

    WHILE v_full_pallets > 0 LOOP
      SELECT p.pallet_id INTO v_reserved_pallet_id
      FROM pallets p
      WHERE p.sku = r.item_code
        AND p.current_zone = v_home_zone
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
        AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        AND p.pallet_id NOT IN (SELECT pr.pallet_id FROM pallet_reservations pr WHERE pr.released_at IS NULL)
      ORDER BY p.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1;

      IF v_reserved_pallet_id IS NULL THEN
        v_can_release := false;
        EXIT;
      END IF;

      v_task_id := 'REPL-' || to_char(now(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 10000)::text, 4, '0');
      INSERT INTO replenishment_tasks (
        task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
        status, task_type, trigger_reason, priority, reserved_pallet_id
      ) VALUES (
        v_task_id, p_order_id, r.id, r.item_code, v_pallet_size, v_home_zone, 'Dispatch Loading Area',
        'PENDING', 'DT_MOVE', 'ORDER_LINE', v_priority, v_reserved_pallet_id
      );
      v_priority := v_priority + 1;

      INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
      VALUES (p_order_id, r.id, v_reserved_pallet_id, v_pallet_size, 'DT_MOVE');

      v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', v_pallet_size, 'type', 'DT');
      v_full_pallets := v_full_pallets - 1;
    END LOOP;

    IF v_partial_units > 0 THEN
      SELECT p.pallet_id INTO v_reserved_pallet_id
      FROM pallets p
      WHERE p.sku = r.item_code
        AND p.current_zone = v_home_zone
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
        AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        AND p.pallet_id NOT IN (SELECT pr.pallet_id FROM pallet_reservations pr WHERE pr.released_at IS NULL)
      ORDER BY p.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1;

      IF v_reserved_pallet_id IS NULL THEN
        v_can_release := false;
      ELSE
        v_task_id := 'REPL-' || to_char(now(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 10000)::text, 4, '0');
        INSERT INTO replenishment_tasks (
          task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
          status, task_type, trigger_reason, priority, reserved_pallet_id
        ) VALUES (
          v_task_id, p_order_id, r.id, r.item_code, v_pallet_size, v_home_zone, 'SuperMarket Area',
          'PENDING', 'ORDER_PICK', 'ORDER_LINE', v_priority, v_reserved_pallet_id
        );
        v_priority := v_priority + 1;

        INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
        VALUES (p_order_id, r.id, v_reserved_pallet_id, v_pallet_size, 'MT_MOVE');

        v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', v_partial_units, 'type', 'MT');
      END IF;
    END IF;
  END LOOP;

  UPDATE orders o SET
    short_lines_count = (SELECT COUNT(*) FROM order_lines WHERE order_id = o.id AND status = 'SHORT'),
    picked_lines_count = (SELECT COUNT(*) FROM order_lines WHERE order_id = o.id AND status = 'PICKED')
  WHERE o.id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'tasks_created', jsonb_array_length(v_tasks),
    'tasks', v_tasks,
    'can_release', v_can_release,
    'message', CASE WHEN v_can_release THEN 'All lines available' ELSE 'Tasks created; some lines need zone replenishment' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Public API: resolve UUID/external/pallet_id and call allocator
CREATE OR REPLACE FUNCTION check_order_availability(p_order_id text)
RETURNS jsonb AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF p_order_id IS NULL OR trim(p_order_id) = '' THEN
    RAISE EXCEPTION 'Order ID is required';
  END IF;
  BEGIN
    v_order_id := p_order_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_order_id FROM orders WHERE external_order_no = p_order_id LIMIT 1;
    IF NOT FOUND THEN
      SELECT order_id INTO v_order_id FROM order_pallets WHERE pallet_id = p_order_id LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found. Got: %', p_order_id;
      END IF;
    END IF;
  END;

  RETURN check_order_availability_alloc(v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- release_pallet_reservations: same
CREATE OR REPLACE FUNCTION release_pallet_reservations(p_order_id text)
RETURNS int AS $$
DECLARE v_order_id uuid; v_count int;
BEGIN
  IF p_order_id IS NULL OR trim(p_order_id) = '' THEN RETURN 0; END IF;
  BEGIN
    v_order_id := p_order_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_order_id FROM orders WHERE external_order_no = p_order_id LIMIT 1;
    IF NOT FOUND THEN
      SELECT order_id INTO v_order_id FROM order_pallets WHERE pallet_id = p_order_id LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found. Got: %', p_order_id; END IF;
    END IF;
  END;
  UPDATE pallet_reservations SET released_at = now() WHERE order_id = v_order_id AND released_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- push_order_to_dispatch: create uuid version FIRST (internal), then text wrapper
CREATE OR REPLACE FUNCTION push_order_to_dispatch_uuid(p_order_id uuid, p_moved_by text DEFAULT 'System')
RETURNS jsonb AS $$
DECLARE v_line record; v_pallet record; v_op record; v_qty_needed numeric; v_qty_allocated numeric;
  v_pallets_moved text[] := '{}'; v_res jsonb; v_order_ref text; v_pushed_at timestamptz;
  v_uses_order_pallets boolean := false; v_in_progress_count int;
BEGIN
  IF p_order_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Missing order_id'); END IF;
  SELECT external_order_no, pushed_to_dispatch_at INTO v_order_ref, v_pushed_at FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order not found'); END IF;
  IF v_pushed_at IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Order already pushed to dispatch'); END IF;
  IF NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = p_order_id AND o.status IN ('AWAITING_SM_RELEASE', 'COMPLETED')) AND
     COALESCE((SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = p_order_id AND ol.status IN ('PICKED','SHORT')) * 100 / NULLIF((SELECT total_lines FROM orders WHERE id = p_order_id), 0), 0) < 75 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order must be 75%+ picked or submitted for release (AWAITING_SM_RELEASE)');
  END IF;
  v_order_ref := COALESCE(v_order_ref, 'ORD-' || p_order_id::text);
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_pallets') THEN
    v_uses_order_pallets := EXISTS (SELECT 1 FROM order_pallets WHERE order_id = p_order_id);
  END IF;
  IF v_uses_order_pallets THEN
    SELECT COUNT(*) INTO v_in_progress_count FROM order_pallets WHERE order_id = p_order_id AND status = 'in_progress';
    IF v_in_progress_count > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot push: ' || v_in_progress_count || ' pallet(s) still in progress.');
    END IF;
  END IF;
  IF v_uses_order_pallets THEN
    FOR v_op IN SELECT op.pallet_id FROM order_pallets op JOIN pallets p ON p.pallet_id = op.pallet_id
      WHERE op.order_id = p_order_id AND op.status = 'released' AND p.current_zone = 'SuperMarket Area'
      AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '') ORDER BY op.sequence
    LOOP
      BEGIN
        v_res := movement_initiate(v_op.pallet_id, 'Dispatch Loading Area', COALESCE(NULLIF(trim(p_moved_by), ''), 'System'), 'Push to dispatch: Order ' || v_order_ref, '', NULL, v_order_ref);
        IF (v_res->>'success')::boolean THEN v_pallets_moved := v_pallets_moved || v_op.pallet_id; END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END LOOP;
  ELSE
    FOR v_line IN SELECT ol.item_code, SUM(ol.quantity) AS quantity FROM order_lines ol
      WHERE ol.order_id = p_order_id AND ol.status = 'PICKED' AND ol.item_code IS NOT NULL GROUP BY ol.item_code
    LOOP
      v_qty_needed := COALESCE(v_line.quantity, 0);
      IF v_qty_needed <= 0 THEN CONTINUE; END IF;
      FOR v_pallet IN SELECT p.pallet_id, p.remaining_quantity, p.quantity FROM pallets p
        WHERE p.current_zone = 'SuperMarket Area' AND p.sku = v_line.item_code
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '') AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        ORDER BY p.created_at ASC
      LOOP
        EXIT WHEN v_qty_needed <= 0;
        v_qty_allocated := LEAST(v_qty_needed, COALESCE(v_pallet.remaining_quantity, v_pallet.quantity, 0));
        IF v_qty_allocated <= 0 THEN CONTINUE; END IF;
        BEGIN
          v_res := movement_initiate(v_pallet.pallet_id, 'Dispatch Loading Area', COALESCE(NULLIF(trim(p_moved_by), ''), 'System'), 'Push to dispatch: Order ' || v_order_ref, '', NULL, v_order_ref);
          IF (v_res->>'success')::boolean THEN v_pallets_moved := v_pallets_moved || v_pallet.pallet_id; END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_qty_needed := v_qty_needed - v_qty_allocated;
      END LOOP;
    END LOOP;
  END IF;
  -- IMPORTANT: only stamp pushed_to_dispatch_at when we actually moved pallets.
  -- Otherwise, we would block future pushes (and zone-clerk release) while nothing moved.
  IF COALESCE(array_length(v_pallets_moved, 1), 0) > 0 THEN
    UPDATE orders
    SET pushed_to_dispatch_at = now(),
        pushed_to_dispatch_by = NULLIF(trim(p_moved_by), '')
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'pallets_moved', COALESCE(array_length(v_pallets_moved, 1), 0),
    'pallet_ids', v_pallets_moved,
    'message', CASE
      WHEN COALESCE(array_length(v_pallets_moved, 1), 0) > 0 THEN 'Order pushed'
      ELSE 'No eligible pallets to push yet; not marking pushed_to_dispatch_at'
    END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- push_order_to_dispatch: text wrapper (public API)
CREATE OR REPLACE FUNCTION push_order_to_dispatch(p_order_id text, p_moved_by text DEFAULT 'System')
RETURNS jsonb AS $$
DECLARE v_order_id uuid;
BEGIN
  IF p_order_id IS NULL OR trim(p_order_id) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'Missing order_id'); END IF;
  BEGIN
    v_order_id := p_order_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_order_id FROM orders WHERE external_order_no = p_order_id LIMIT 1;
    IF NOT FOUND THEN SELECT order_id INTO v_order_id FROM order_pallets WHERE pallet_id = p_order_id LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order not found: ' || p_order_id); END IF; END IF;
  END;
  RETURN push_order_to_dispatch_uuid(v_order_id, COALESCE(p_moved_by, 'System'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- release_order_pallet: accept text for p_order_id
CREATE OR REPLACE FUNCTION release_order_pallet(p_order_id text, p_pallet_id text, p_released_by text DEFAULT '')
RETURNS jsonb AS $$
DECLARE v_order_id uuid; v_op order_pallets%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR NULLIF(trim(p_pallet_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order_id or pallet_id');
  END IF;
  BEGIN
    v_order_id := p_order_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_order_id FROM orders WHERE external_order_no = p_order_id LIMIT 1;
    IF NOT FOUND THEN SELECT order_id INTO v_order_id FROM order_pallets WHERE pallet_id = p_order_id LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order not found'); END IF; END IF;
  END;
  SELECT * INTO v_op FROM order_pallets WHERE order_id = v_order_id AND pallet_id = p_pallet_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Order pallet not found'); END IF;
  IF v_op.status != 'complete' THEN RETURN jsonb_build_object('success', false, 'error', 'Pallet must be complete before release'); END IF;
  UPDATE order_pallets SET status = 'released' WHERE order_id = v_order_id AND pallet_id = p_pallet_id;
  RETURN jsonb_build_object('success', true, 'message', 'Pallet ' || p_pallet_id || ' released');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_order_availability(text) TO anon;
GRANT EXECUTE ON FUNCTION release_pallet_reservations(text) TO anon;
GRANT EXECUTE ON FUNCTION push_order_to_dispatch(text, text) TO anon;
GRANT EXECUTE ON FUNCTION release_order_pallet(text, text, text) TO anon;

-- Verify: run this to confirm functions exist (should show ONLY text signatures)
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname IN ('check_order_availability', 'release_pallet_reservations', 'push_order_to_dispatch', 'release_order_pallet') AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- CRITICAL: Reload PostgREST schema cache so it picks up the new functions
-- (Supabase does this automatically on deploy, but manual SQL may need a nudge)
NOTIFY pgrst, 'reload schema';
