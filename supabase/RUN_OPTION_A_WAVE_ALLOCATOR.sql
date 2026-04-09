-- RetiFlux™ — Option A allocator + wave runner
--
-- Policy enforced:
-- 1) Prefer full pallets in SuperMarket for direct Dispatch (DT_MOVE).
-- 2) Picker handles only residual balances from SuperMarket (SM_PICK).
-- 3) If still short, consume home-zone full pallets to Dispatch (DT_MOVE).
-- 4) Final residual from home zone becomes ORDER_PICK to SuperMarket (MT path).
--
-- This script also adds run_allocation_wave(p_order_id text default null, p_limit int default 50)
-- so the UI can run allocation explicitly after order release.

CREATE OR REPLACE FUNCTION public.check_order_availability_uuid(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  r2 RECORD;
  v_remaining numeric;
  v_home_zone text;
  v_task_id text;
  v_wh_free numeric;
  v_priority int := 10;
  v_can_release boolean := true;
  v_tasks jsonb := '[]'::jsonb;
  v_reserved numeric;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order_id');
  END IF;

  -- Recompute as single source of truth for this order.
  UPDATE pallet_reservations
  SET released_at = now()
  WHERE order_id = p_order_id
    AND released_at IS NULL;

  DELETE FROM replenishment_tasks
  WHERE order_id = p_order_id
    AND status IN ('PENDING', 'IN_PROGRESS')
    AND trigger_reason = 'ORDER_LINE';

  -- Reopen non-picked lines for deterministic re-allocation.
  UPDATE order_lines
  SET status = 'OPEN',
      short_quantity = 0
  WHERE order_id = p_order_id
    AND status IN ('OPEN', 'SHORT', 'PICKER_REPORTED_SHORT');

  FOR r IN
    SELECT ol.id, ol.item_code, COALESCE(ol.quantity, 0)::numeric AS quantity
    FROM order_lines ol
    WHERE ol.order_id = p_order_id
      AND ol.status = 'OPEN'
    ORDER BY ol.line_no
  LOOP
    v_remaining := GREATEST(COALESCE(r.quantity, 0), 0);
    IF v_remaining <= 0 THEN
      CONTINUE;
    END IF;

    -- Resolve SKU home zone once.
    SELECT s.home_zone
    INTO v_home_zone
    FROM skus s
    WHERE s.sku = r.item_code
      AND s.is_active = true
    LIMIT 1;

    -- A) Option A first step: full pallets in SuperMarket -> DT_MOVE to Dispatch.
    FOR r2 IN
      SELECT p.pallet_id, COALESCE(p.remaining_quantity, p.quantity, 0)::numeric AS avail_qty
      FROM pallets p
      WHERE p.sku = r.item_code
        AND p.current_zone = 'SuperMarket Area'
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
        AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM pallet_reservations pr
          WHERE pr.pallet_id = p.pallet_id
            AND pr.released_at IS NULL
        )
      ORDER BY p.created_at ASC, p.pallet_id ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      -- DT from SM is only for full pallets.
      EXIT WHEN v_remaining < COALESCE(r2.avail_qty, 0);
      IF COALESCE(r2.avail_qty, 0) <= 0 THEN CONTINUE; END IF;

      v_task_id := 'REPL-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6);

      INSERT INTO replenishment_tasks (
        task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
        status, task_type, trigger_reason, priority, reserved_pallet_id
      ) VALUES (
        v_task_id, p_order_id, r.id, r.item_code, r2.avail_qty, 'SuperMarket Area', 'Dispatch Loading Area',
        'PENDING', 'DT_MOVE', 'ORDER_LINE', v_priority, r2.pallet_id
      );

      INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
      VALUES (p_order_id, r.id, r2.pallet_id, r2.avail_qty, 'DT_MOVE')
      ON CONFLICT (order_id, order_line_id, pallet_id) DO UPDATE
      SET quantity_reserved = EXCLUDED.quantity_reserved,
          reservation_type = EXCLUDED.reservation_type,
          released_at = NULL;

      v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', r2.avail_qty, 'type', 'DT_SM');
      v_remaining := v_remaining - r2.avail_qty;
      v_priority := v_priority + 1;
    END LOOP;

    -- B) Picker residual from SuperMarket only (balance-only picking).
    FOR r2 IN
      SELECT p.pallet_id, COALESCE(p.remaining_quantity, p.quantity, 0)::numeric AS avail_qty
      FROM pallets p
      WHERE p.sku = r.item_code
        AND p.current_zone = 'SuperMarket Area'
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
        AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM pallet_reservations pr
          WHERE pr.pallet_id = p.pallet_id
            AND pr.released_at IS NULL
        )
      ORDER BY p.created_at ASC, p.pallet_id ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_reserved := LEAST(v_remaining, COALESCE(r2.avail_qty, 0));
      IF v_reserved <= 0 THEN CONTINUE; END IF;

      INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
      VALUES (p_order_id, r.id, r2.pallet_id, v_reserved, 'SM_PICK')
      ON CONFLICT (order_id, order_line_id, pallet_id) DO UPDATE
      SET quantity_reserved = EXCLUDED.quantity_reserved,
          reservation_type = EXCLUDED.reservation_type,
          released_at = NULL;

      v_tasks := v_tasks || jsonb_build_object('sku', r.item_code, 'qty', v_reserved, 'type', 'SM_PICK');
      v_remaining := v_remaining - v_reserved;
    END LOOP;

    -- If fully covered by SM dispatch + SM picker balances, done.
    IF v_remaining <= 0 THEN
      CONTINUE;
    END IF;

    -- No home zone mapping => still short.
    IF v_home_zone IS NULL THEN
      UPDATE order_lines
      SET status = 'SHORT',
          short_quantity = GREATEST(v_remaining, 0)
      WHERE id = r.id;
      v_can_release := false;
      CONTINUE;
    END IF;

    -- C) Home zone full pallets to Dispatch (DT_MOVE).
    FOR r2 IN
      SELECT p.pallet_id, COALESCE(p.remaining_quantity, p.quantity, 0)::numeric AS avail_qty
      FROM pallets p
      WHERE p.sku = r.item_code
        AND p.current_zone = v_home_zone
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
        AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM pallet_reservations pr
          WHERE pr.pallet_id = p.pallet_id
            AND pr.released_at IS NULL
        )
      ORDER BY p.created_at ASC, p.pallet_id ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      IF COALESCE(r2.avail_qty, 0) <= 0 THEN CONTINUE; END IF;

      v_task_id := 'REPL-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6);

      IF v_remaining >= r2.avail_qty THEN
        INSERT INTO replenishment_tasks (
          task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
          status, task_type, trigger_reason, priority, reserved_pallet_id
        ) VALUES (
          v_task_id, p_order_id, r.id, r.item_code, r2.avail_qty, v_home_zone, 'Dispatch Loading Area',
          'PENDING', 'DT_MOVE', 'ORDER_LINE', v_priority, r2.pallet_id
        );

        INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
        VALUES (p_order_id, r.id, r2.pallet_id, r2.avail_qty, 'DT_MOVE')
        ON CONFLICT (order_id, order_line_id, pallet_id) DO UPDATE
        SET quantity_reserved = EXCLUDED.quantity_reserved,
            reservation_type = EXCLUDED.reservation_type,
            released_at = NULL;

        v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', r2.avail_qty, 'type', 'DT_ZONE');
        v_remaining := v_remaining - r2.avail_qty;
        v_priority := v_priority + 1;
      ELSE
        -- D) Final residual from zone goes to SM path for picker.
        INSERT INTO replenishment_tasks (
          task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
          status, task_type, trigger_reason, priority, reserved_pallet_id
        ) VALUES (
          v_task_id, p_order_id, r.id, r.item_code, v_remaining, v_home_zone, 'SuperMarket Area',
          'PENDING', 'ORDER_PICK', 'ORDER_LINE', v_priority, r2.pallet_id
        );

        INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
        VALUES (p_order_id, r.id, r2.pallet_id, v_remaining, 'MT_MOVE')
        ON CONFLICT (order_id, order_line_id, pallet_id) DO UPDATE
        SET quantity_reserved = EXCLUDED.quantity_reserved,
            reservation_type = EXCLUDED.reservation_type,
            released_at = NULL;

        v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', v_remaining, 'type', 'MT');
        v_remaining := 0;
        v_priority := v_priority + 1;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      -- Soft-book rule: if stock exists anywhere in warehouse, do not hard-block release.
      -- Keep picker from false SHORT while upstream moves catch up.
      SELECT COALESCE(SUM(COALESCE(p.remaining_quantity, p.quantity, 0)), 0)::numeric
      INTO v_wh_free
      FROM pallets p
      WHERE p.sku = r.item_code
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
        AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0;

      IF COALESCE(v_wh_free, 0) >= v_remaining THEN
        -- Enough units exist in warehouse; create a soft upstream move request.
        v_task_id := 'REPL-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6);
        INSERT INTO replenishment_tasks (
          task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
          status, task_type, trigger_reason, priority, notes
        ) VALUES (
          v_task_id, p_order_id, r.id, r.item_code, v_remaining, 'Receiving Area', COALESCE(v_home_zone, 'SuperMarket Area'),
          'PENDING', 'ZONE_REPLENISH', 'ORDER_LINE', v_priority, 'SOFT_BOOKED_PENDING_STOCK'
        );
        v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', v_remaining, 'type', 'SOFT_BOOK');
        v_priority := v_priority + 1;

        UPDATE order_lines
        SET status = 'OPEN',
            short_quantity = 0
        WHERE id = r.id;
      ELSE
        -- True warehouse shortage: keep SHORT and block release.
        UPDATE order_lines
        SET status = 'SHORT',
            short_quantity = GREATEST(v_remaining, 0)
        WHERE id = r.id;
        v_can_release := false;
      END IF;
    END IF;
  END LOOP;

  UPDATE orders o
  SET
    short_lines_count = (
      SELECT COUNT(*)
      FROM order_lines ol
      WHERE ol.order_id = o.id
        AND ol.status = 'SHORT'
    ),
    picked_lines_count = (
      SELECT COUNT(*)
      FROM order_lines ol
      WHERE ol.order_id = o.id
        AND ol.status = 'PICKED'
    )
  WHERE o.id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'tasks_created', jsonb_array_length(v_tasks),
    'tasks', v_tasks,
    'can_release', v_can_release,
    'message', CASE
      WHEN v_can_release THEN 'Option A allocation complete'
      ELSE 'Option A allocation complete with pending shortages'
    END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.run_allocation_wave(p_order_id text DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  v_res jsonb;
  v_processed int := 0;
  v_tasks int := 0;
  v_short int := 0;
BEGIN
  IF p_order_id IS NOT NULL AND trim(p_order_id) <> '' THEN
    v_res := public.check_order_availability(p_order_id);
    RETURN jsonb_build_object(
      'success', COALESCE((v_res->>'success')::boolean, true),
      'mode', 'single',
      'orders_processed', 1,
      'tasks_created', COALESCE((v_res->>'tasks_created')::int, 0),
      'can_release', COALESCE((v_res->>'can_release')::boolean, false),
      'message', COALESCE(v_res->>'message', 'Allocation wave completed')
    );
  END IF;

  FOR r IN
    SELECT o.id, o.external_order_no
    FROM orders o
    WHERE o.status IN ('AWAITING_RELEASE', 'RELEASED', 'IN_PROGRESS', 'AWAITING_SM_RELEASE')
    ORDER BY o.created_at ASC, o.external_order_no ASC
    LIMIT GREATEST(1, COALESCE(p_limit, 50))
  LOOP
    v_res := public.check_order_availability(r.id::text);
    v_processed := v_processed + 1;
    v_tasks := v_tasks + COALESCE((v_res->>'tasks_created')::int, 0);
    IF COALESCE((v_res->>'can_release')::boolean, false) = false THEN
      v_short := v_short + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'wave',
    'orders_processed', v_processed,
    'tasks_created', v_tasks,
    'orders_ready_to_release', GREATEST(v_processed - v_short, 0),
    'orders_with_shortage', v_short,
    'message', 'Allocation wave completed'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.check_order_availability_uuid(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.run_allocation_wave(text, integer) TO anon;

-- Optional quick checks:
-- SELECT public.run_allocation_wave(NULL, 20);
-- SELECT public.run_allocation_wave('YOUR_ORDER_UUID_OR_EXTERNAL_NO', 1);
