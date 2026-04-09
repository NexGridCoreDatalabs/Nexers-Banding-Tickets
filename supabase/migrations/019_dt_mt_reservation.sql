-- RetiFlux™ — DT/MT allocation, pallet reservations, FCFS at assignment
-- Migration 019: Run after 003, 018.
-- Implements: SM-first allocation, full pallets → Dispatch (DT), split → SuperMarket (MT),
--             pallet_reservations, reserve at assignment.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pallet_reservations — FCFS reservation at order assignment
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pallet_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_id uuid REFERENCES order_lines(id) ON DELETE CASCADE,
  pallet_id text NOT NULL REFERENCES pallets(pallet_id) ON DELETE CASCADE,
  quantity_reserved numeric(14,2) NOT NULL DEFAULT 0,
  reservation_type text NOT NULL CHECK (reservation_type IN ('SM_PICK', 'DT_MOVE', 'MT_MOVE')),
  replenishment_task_id uuid REFERENCES replenishment_tasks(id) ON DELETE SET NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE(order_id, order_line_id, pallet_id)
);

CREATE INDEX IF NOT EXISTS pallet_reservations_order_id_idx ON pallet_reservations(order_id);
CREATE INDEX IF NOT EXISTS pallet_reservations_pallet_id_idx ON pallet_reservations(pallet_id);
CREATE INDEX IF NOT EXISTS pallet_reservations_released_idx ON pallet_reservations(released_at) WHERE released_at IS NULL;

ALTER TABLE pallet_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pallet_reservations_anon_select" ON pallet_reservations;
CREATE POLICY "pallet_reservations_anon_select" ON pallet_reservations FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "pallet_reservations_anon_insert" ON pallet_reservations;
CREATE POLICY "pallet_reservations_anon_insert" ON pallet_reservations FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "pallet_reservations_anon_update" ON pallet_reservations;
CREATE POLICY "pallet_reservations_anon_update" ON pallet_reservations FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Extend replenishment_tasks: reserved_pallet_id, task_type DT_MOVE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE replenishment_tasks ADD COLUMN IF NOT EXISTS reserved_pallet_id text REFERENCES pallets(pallet_id) ON DELETE SET NULL;

ALTER TABLE replenishment_tasks DROP CONSTRAINT IF EXISTS replenishment_tasks_task_type_check;
ALTER TABLE replenishment_tasks ADD CONSTRAINT replenishment_tasks_task_type_check
  CHECK (task_type IN ('ORDER_PICK', 'SM_REPLENISH', 'ZONE_REPLENISH', 'DT_MOVE'));

CREATE INDEX IF NOT EXISTS replenishment_tasks_to_zone_idx ON replenishment_tasks(to_zone);
CREATE INDEX IF NOT EXISTS replenishment_tasks_reserved_pallet_idx ON replenishment_tasks(reserved_pallet_id) WHERE reserved_pallet_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_available_sm_qty_for_order(sku, order_id) — SM qty excluding reserved
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_available_sm_qty_for_order(p_sku text, p_order_id uuid)
RETURNS numeric AS $$
  SELECT COALESCE(SUM(COALESCE(p.remaining_quantity, p.quantity, 0)), 0)::numeric
  FROM pallets p
  WHERE p.sku = p_sku AND p.current_zone = 'SuperMarket Area'
    AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
    AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
    AND p.pallet_id NOT IN (
      SELECT pr.pallet_id FROM pallet_reservations pr
      WHERE pr.released_at IS NULL AND pr.order_id != p_order_id
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_fifo_pallet_for_task(p_task_id text) — reserved pallet or FIFO fallback
-- p_task_id = replenishment_tasks.task_id (text)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_fifo_pallet_for_task(p_task_id text)
RETURNS text AS $$
DECLARE
  v_task replenishment_tasks%ROWTYPE;
  v_pallet_id text;
BEGIN
  SELECT * INTO v_task FROM replenishment_tasks WHERE task_id = p_task_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_task.reserved_pallet_id IS NOT NULL THEN
    SELECT pallet_id INTO v_pallet_id FROM pallets
    WHERE pallet_id = v_task.reserved_pallet_id
      AND current_zone = v_task.from_zone
      AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '');
    IF FOUND THEN RETURN v_pallet_id; END IF;
  END IF;

  RETURN get_fifo_pallet_for_zone_sku(v_task.from_zone, v_task.sku);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. check_order_availability (replaced) — DT/MT allocation, reservations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_order_availability(p_order_id uuid)
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
  v_zone_pallet pallets%ROWTYPE;
  v_reserved_pallet_id text;
  v_pallets_reserved int;
BEGIN
  FOR r IN
    SELECT ol.id, ol.item_code, ol.quantity, ol.status
    FROM order_lines ol
    WHERE ol.order_id = p_order_id AND ol.status = 'OPEN'
  LOOP
    v_sm_qty := get_available_sm_qty_for_order(r.item_code, p_order_id);
    v_alloc_from_sm := LEAST(r.quantity, v_sm_qty);
    v_remaining := r.quantity - v_alloc_from_sm;

    IF v_alloc_from_sm > 0 THEN
      FOR v_zone_pallet IN
        SELECT p.pallet_id, COALESCE(p.remaining_quantity, p.quantity, 0) AS qty
        FROM pallets p
        WHERE p.sku = r.item_code AND p.current_zone = 'SuperMarket Area'
          AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
          AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
          AND p.pallet_id NOT IN (SELECT pr.pallet_id FROM pallet_reservations pr WHERE pr.released_at IS NULL)
        ORDER BY p.created_at ASC
      LOOP
        EXIT WHEN v_alloc_from_sm <= 0;
        INSERT INTO pallet_reservations (order_id, order_line_id, pallet_id, quantity_reserved, reservation_type)
        VALUES (p_order_id, r.id, v_zone_pallet.pallet_id, LEAST(v_alloc_from_sm, v_zone_pallet.qty), 'SM_PICK')
        ON CONFLICT (order_id, order_line_id, pallet_id) DO NOTHING;
        v_alloc_from_sm := v_alloc_from_sm - LEAST(v_alloc_from_sm, v_zone_pallet.qty);
      END LOOP;
    END IF;

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
    WHERE p.sku = r.item_code AND p.current_zone = v_home_zone
      AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
      AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
      AND p.pallet_id NOT IN (
        SELECT pr.pallet_id FROM pallet_reservations pr WHERE pr.released_at IS NULL
      )
    ORDER BY p.created_at ASC
    LIMIT 1;

    IF v_pallet_size IS NULL OR v_pallet_size <= 0 THEN
      UPDATE order_lines SET status = 'SHORT', short_quantity = r.quantity WHERE id = r.id;
      v_can_release := false;
      CONTINUE;
    END IF;

    v_full_pallets := FLOOR(v_remaining / v_pallet_size)::int;
    v_partial_units := v_remaining - (v_full_pallets * v_pallet_size);

    FOR v_pallets_reserved IN 1..v_full_pallets LOOP
      SELECT p.pallet_id INTO v_reserved_pallet_id
      FROM pallets p
      WHERE p.sku = r.item_code AND p.current_zone = v_home_zone
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
        AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        AND p.pallet_id NOT IN (
          SELECT pr.pallet_id FROM pallet_reservations pr WHERE pr.released_at IS NULL
        )
      ORDER BY p.created_at ASC
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
    END LOOP;

    IF v_partial_units > 0 THEN
      SELECT p.pallet_id INTO v_reserved_pallet_id
      FROM pallets p
      WHERE p.sku = r.item_code AND p.current_zone = v_home_zone
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
        AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
        AND p.pallet_id NOT IN (
          SELECT pr.pallet_id FROM pallet_reservations pr WHERE pr.released_at IS NULL
        )
      ORDER BY p.created_at ASC
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. release_pallet_reservations(p_order_id) — call when order completes/cancels
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_pallet_reservations(p_order_id uuid)
RETURNS int AS $$
DECLARE v_count int;
BEGIN
  UPDATE pallet_reservations SET released_at = now() WHERE order_id = p_order_id AND released_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Zone transitions: ensure product zones → Dispatch Loading Area
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO zone_transitions (from_zone, to_zone)
SELECT vz, 'Dispatch Loading Area'
FROM (VALUES ('Detergents Zone'), ('Fats Zone'), ('Liquids/Oils Zone'), ('Soaps Zone'), ('Foods & Beverages Zone')) AS t(vz)
ON CONFLICT (from_zone, to_zone) DO NOTHING;

GRANT EXECUTE ON FUNCTION get_available_sm_qty_for_order(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_fifo_pallet_for_task(text) TO anon;
GRANT EXECUTE ON FUNCTION release_pallet_reservations(uuid) TO anon;
