-- RetiFlux™ — Align allocation to single source of truth (SM-first -> DT full pallets -> residual to SM)
--
-- Operational model enforced:
-- 1) Consume SuperMarket stock first (FIFO reservations, SM_PICK)
-- 2) If demand remains, use home-zone full pallets to Dispatch (DT_MOVE)
-- 3) If only a residual remains, move that residual path to SuperMarket (ORDER_PICK + MT_MOVE reservation)
-- 4) No extra "SM buffer pallet" side-rule; FIFO/replenishment remains the only mechanism.
--
-- Notes:
-- - Re-running this script is safe; it only replaces check_order_availability().
-- - Function starts by clearing prior open ORDER_LINE allocations for the same order
--   so recomputation is deterministic and remains the single truth.

CREATE OR REPLACE FUNCTION check_order_availability(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  r2 RECORD;
  v_sm_remaining numeric;
  v_zone_remaining numeric;
  v_home_zone text;
  v_task_id text;
  v_priority int := 10;
  v_can_release boolean := true;
  v_tasks jsonb := '[]'::jsonb;
  v_reserved numeric;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order_id');
  END IF;

  -- Reset open fulfillment plan for this order (single-source recompute).
  UPDATE pallet_reservations
  SET released_at = now()
  WHERE order_id = p_order_id
    AND released_at IS NULL;

  DELETE FROM replenishment_tasks
  WHERE order_id = p_order_id
    AND status IN ('PENDING', 'IN_PROGRESS')
    AND trigger_reason = 'ORDER_LINE';

  FOR r IN
    SELECT ol.id, ol.item_code, ol.quantity
    FROM order_lines ol
    WHERE ol.order_id = p_order_id
      AND ol.status = 'OPEN'
    ORDER BY ol.line_no
  LOOP
    v_sm_remaining := COALESCE(r.quantity, 0);
    IF v_sm_remaining <= 0 THEN
      CONTINUE;
    END IF;

    -- 1) SuperMarket first (FIFO). Reserve exact quantity needed from each pallet.
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
            AND pr.order_id <> p_order_id
        )
      ORDER BY p.created_at ASC, p.pallet_id ASC
    LOOP
      EXIT WHEN v_sm_remaining <= 0;
      v_reserved := LEAST(v_sm_remaining, COALESCE(r2.avail_qty, 0));
      IF v_reserved <= 0 THEN CONTINUE; END IF;

      INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
      VALUES (p_order_id, r.id, r2.pallet_id, v_reserved, 'SM_PICK');

      v_sm_remaining := v_sm_remaining - v_reserved;
    END LOOP;

    -- If SM fully covers the line, done.
    IF v_sm_remaining <= 0 THEN
      CONTINUE;
    END IF;

    -- 2/3) Zone stage: full pallets -> DT_MOVE; residual -> ORDER_PICK to SuperMarket.
    SELECT s.home_zone
    INTO v_home_zone
    FROM skus s
    WHERE s.sku = r.item_code
      AND s.is_active = true
    LIMIT 1;

    IF v_home_zone IS NULL THEN
      UPDATE order_lines
      SET status = 'SHORT', short_quantity = COALESCE(quantity, 0)
      WHERE id = r.id;
      v_can_release := false;
      CONTINUE;
    END IF;

    v_zone_remaining := v_sm_remaining;

    FOR r2 IN
      SELECT p.pallet_id,
             COALESCE(p.remaining_quantity, p.quantity, 0)::numeric AS avail_qty
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
            AND pr.order_id <> p_order_id
        )
      ORDER BY p.created_at ASC, p.pallet_id ASC
    LOOP
      EXIT WHEN v_zone_remaining <= 0;

      IF COALESCE(r2.avail_qty, 0) <= 0 THEN
        CONTINUE;
      END IF;

      v_task_id := 'REPL-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6);

      -- Full pallet to dispatch as DT.
      IF v_zone_remaining >= r2.avail_qty THEN
        INSERT INTO replenishment_tasks (
          task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
          status, task_type, trigger_reason, priority, reserved_pallet_id
        ) VALUES (
          v_task_id, p_order_id, r.id, r.item_code, r2.avail_qty, v_home_zone, 'Dispatch Loading Area',
          'PENDING', 'DT_MOVE', 'ORDER_LINE', v_priority, r2.pallet_id
        );

        INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
        VALUES (p_order_id, r.id, r2.pallet_id, r2.avail_qty, 'DT_MOVE');

        v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', r2.avail_qty, 'type', 'DT');
        v_zone_remaining := v_zone_remaining - r2.avail_qty;
        v_priority := v_priority + 1;
      ELSE
        -- Residual only: move this pallet to SuperMarket path (FIFO residual handling).
        INSERT INTO replenishment_tasks (
          task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
          status, task_type, trigger_reason, priority, reserved_pallet_id
        ) VALUES (
          v_task_id, p_order_id, r.id, r.item_code, v_zone_remaining, v_home_zone, 'SuperMarket Area',
          'PENDING', 'ORDER_PICK', 'ORDER_LINE', v_priority, r2.pallet_id
        );

        INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
        VALUES (p_order_id, r.id, r2.pallet_id, v_zone_remaining, 'MT_MOVE');

        v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', v_zone_remaining, 'type', 'MT');
        v_zone_remaining := 0;
        v_priority := v_priority + 1;
      END IF;
    END LOOP;

    IF v_zone_remaining > 0 THEN
      UPDATE order_lines
      SET status = 'SHORT',
          short_quantity = GREATEST(v_zone_remaining, 0)
      WHERE id = r.id;
      v_can_release := false;
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
      WHEN v_can_release THEN 'SM-first allocation complete'
      ELSE 'SM-first allocation complete with shortages/tasks pending'
    END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

