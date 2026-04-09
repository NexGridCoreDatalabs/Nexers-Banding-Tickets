-- RetiFlux™ — check_order_availability accepts UUID/external/pallet_id (text)
-- Migration 022: Full pre-allocation with concurrency safety.

-- Drop existing versions
DROP FUNCTION IF EXISTS check_order_availability(text);
DROP FUNCTION IF EXISTS check_order_availability(uuid);
DROP FUNCTION IF EXISTS check_order_availability_impl(uuid);
DROP FUNCTION IF EXISTS check_order_availability_uuid(uuid);
DROP FUNCTION IF EXISTS check_order_availability_alloc(uuid);

-- Internal allocator (uuid only) to avoid PostgREST overload issues
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
    -- Available SM qty excluding other orders' reservations
    v_sm_qty := get_available_sm_qty_for_order(r.item_code, p_order_id);
    v_alloc_from_sm := LEAST(r.quantity, v_sm_qty);
    v_remaining := r.quantity - v_alloc_from_sm;

    -- Reserve from SM pallets (lock pallets to avoid double-reserve)
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

    -- Determine pallet size from FIFO pallet in home zone
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

    -- Full pallets to Dispatch (DT_MOVE)
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

    -- Partial to SuperMarket (MT_MOVE)
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
        RAISE EXCEPTION 'Order not found. Use order UUID, external order number, or pallet ID. Got: %', p_order_id;
      END IF;
    END IF;
  END;

  UPDATE orders o SET
    short_lines_count = (SELECT COUNT(*) FROM order_lines WHERE order_id = o.id AND status = 'SHORT'),
    picked_lines_count = (SELECT COUNT(*) FROM order_lines WHERE order_id = o.id AND status = 'PICKED')
  WHERE o.id = v_order_id;

  RETURN check_order_availability_alloc(v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Same for release_pallet_reservations
DROP FUNCTION IF EXISTS release_pallet_reservations(text);
DROP FUNCTION IF EXISTS release_pallet_reservations(uuid);
DROP FUNCTION IF EXISTS release_pallet_reservations_impl(uuid);
DROP FUNCTION IF EXISTS release_pallet_reservations_uuid(uuid);

CREATE OR REPLACE FUNCTION release_pallet_reservations(p_order_id text)
RETURNS int AS $$
DECLARE
  v_order_id uuid;
  v_count int;
BEGIN
  IF p_order_id IS NULL OR trim(p_order_id) = '' THEN
    RETURN 0;
  END IF;
  BEGIN
    v_order_id := p_order_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_order_id FROM orders WHERE external_order_no = p_order_id LIMIT 1;
    IF NOT FOUND THEN
      SELECT order_id INTO v_order_id FROM order_pallets WHERE pallet_id = p_order_id LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found. Use order UUID, external order number, or pallet ID. Got: %', p_order_id;
      END IF;
    END IF;
  END;
  UPDATE pallet_reservations SET released_at = now() WHERE order_id = v_order_id AND released_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_order_availability(text) TO anon;
GRANT EXECUTE ON FUNCTION release_pallet_reservations(text) TO anon;
