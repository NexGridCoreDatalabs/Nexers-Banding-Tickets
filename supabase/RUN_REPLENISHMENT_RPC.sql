-- RetiFlux™ — Replenishment RPCs
-- Run in Supabase SQL Editor after 003_replenishment_and_capacities.sql
-- Prerequisite: skus.home_zone, zone_config.max_capacity, replenishment_tasks extended

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. zone_stock_baseline (for 30%/10% stock-based thresholds)
-- Populated by simulation fill script; used to compute stock_pct = current / baseline
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zone_stock_baseline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone text NOT NULL,
  sku text NOT NULL,
  baseline_pallets integer NOT NULL DEFAULT 0,
  baseline_qty numeric(14,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(zone, sku)
);

CREATE INDEX IF NOT EXISTS zone_stock_baseline_zone_sku_idx ON zone_stock_baseline(zone, sku);

ALTER TABLE zone_stock_baseline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "zone_stock_baseline_anon_select" ON zone_stock_baseline;
CREATE POLICY "zone_stock_baseline_anon_select" ON zone_stock_baseline FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "zone_stock_baseline_anon_insert" ON zone_stock_baseline;
CREATE POLICY "zone_stock_baseline_anon_insert" ON zone_stock_baseline FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "zone_stock_baseline_anon_update" ON zone_stock_baseline;
CREATE POLICY "zone_stock_baseline_anon_update" ON zone_stock_baseline FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Task ID generator for stock-driven tasks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_replenishment_task_id()
RETURNS text AS $$
  SELECT 'REPL-' || to_char(now(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 10000)::text, 4, '0');
$$ LANGUAGE sql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_stock_by_zone_sku(zone_name, sku)
-- Returns: pallet_count, total_qty, oldest_pallet_id (FIFO)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_stock_by_zone_sku(p_zone text, p_sku text)
RETURNS jsonb AS $$
DECLARE
  v_count int;
  v_qty numeric;
  v_oldest_id text;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(COALESCE(remaining_quantity, quantity, 0)), 0)
  INTO v_count, v_qty
  FROM pallets
  WHERE current_zone = p_zone AND sku = p_sku
    AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '');

  SELECT pallet_id INTO v_oldest_id
  FROM pallets
  WHERE current_zone = p_zone AND sku = p_sku
    AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1;

  RETURN jsonb_build_object(
    'pallet_count', COALESCE(v_count, 0),
    'total_qty', COALESCE(v_qty, 0),
    'oldest_pallet_id', v_oldest_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_sm_target(sku) → floor(home_zone_count / 3)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_sm_target(p_sku text)
RETURNS integer AS $$
DECLARE
  v_home_zone text;
  v_count int;
BEGIN
  SELECT home_zone INTO v_home_zone FROM skus WHERE sku = p_sku AND is_active = true LIMIT 1;
  IF v_home_zone IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pallets
  WHERE current_zone = v_home_zone AND sku = p_sku
    AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '');

  RETURN FLOOR(COALESCE(v_count, 0) / 3.0)::integer;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_zone_stock_pct(zone_name, sku) → current/baseline as pct (0-100)
-- Uses zone_stock_baseline; if no baseline, returns 100 (assume full)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_zone_stock_pct(p_zone text, p_sku text)
RETURNS numeric AS $$
DECLARE
  v_baseline int;
  v_current int;
  v_pct numeric;
BEGIN
  SELECT baseline_pallets INTO v_baseline FROM zone_stock_baseline WHERE zone = p_zone AND sku = p_sku;
  IF v_baseline IS NULL OR v_baseline <= 0 THEN
    RETURN 100;
  END IF;

  SELECT COUNT(*) INTO v_current
  FROM pallets
  WHERE current_zone = p_zone AND sku = p_sku
    AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '');

  v_pct := (v_current::numeric / v_baseline::numeric) * 100;
  RETURN LEAST(100, GREATEST(0, v_pct));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. zone_has_capacity(zone_name, additional_pallets)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION zone_has_capacity(p_zone text, p_additional int DEFAULT 1)
RETURNS boolean AS $$
DECLARE
  v_max int;
  v_current int;
BEGIN
  SELECT max_capacity, current_occupancy INTO v_max, v_current
  FROM zone_config WHERE zone_name = p_zone;

  IF v_max IS NULL THEN
    RETURN true;  -- No cap (e.g. Outbonded)
  END IF;

  RETURN (COALESCE(v_current, 0) + COALESCE(p_additional, 0)) <= v_max;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. get_fifo_pallet_for_zone_sku(zone_name, sku)
-- Returns pallet_id of oldest pallet (FIFO) for replenishment execution
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_fifo_pallet_for_zone_sku(p_zone text, p_sku text)
RETURNS text AS $$
  SELECT pallet_id FROM pallets
  WHERE current_zone = p_zone AND sku = p_sku
    AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. check_sm_replenishment()
-- For each SKU in SM: if current < 0.1 * target, create task (home → SM)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_sm_replenishment()
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  v_target int;
  v_current int;
  v_home_zone text;
  v_qty_needed int;
  v_task_id text;
  v_created int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT sku FROM pallets
    WHERE current_zone = 'SuperMarket Area'
      AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
  LOOP
    v_target := get_sm_target(r.sku);
    IF v_target <= 0 THEN
      CONTINUE;
    END IF;

    SELECT (get_stock_by_zone_sku('SuperMarket Area', r.sku)->>'pallet_count')::int INTO v_current;
    IF v_current >= CEIL(v_target * 0.1) THEN
      CONTINUE;  -- Above 10% threshold
    END IF;

    SELECT home_zone INTO v_home_zone FROM skus WHERE sku = r.sku AND is_active = true LIMIT 1;
    IF v_home_zone IS NULL THEN
      CONTINUE;
    END IF;

    v_qty_needed := v_target - v_current;
    IF v_qty_needed <= 0 THEN
      CONTINUE;
    END IF;

    IF NOT zone_has_capacity('SuperMarket Area', v_qty_needed) THEN
      CONTINUE;  -- No space
    END IF;

    v_task_id := generate_replenishment_task_id();
    INSERT INTO replenishment_tasks (
      task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
      status, task_type, trigger_reason, priority
    ) VALUES (
      v_task_id, NULL, NULL, r.sku, v_qty_needed, v_home_zone, 'SuperMarket Area',
      'PENDING', 'SM_REPLENISH', 'SM_BELOW_10PCT', 1
    );

    v_created := v_created + 1;
    v_results := v_results || jsonb_build_object('sku', r.sku, 'task_id', v_task_id, 'qty', v_qty_needed);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'created', v_created, 'tasks', v_results);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. check_zone_replenishment()
-- For each zone+SKU: if stock < 30% → warning; if < 10% → create request (Receiving → zone)
-- Only for product zones (DET, FAT, LIQ, SOP, F&B)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_zone_replenishment()
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  v_pct numeric;
  v_warnings int := 0;
  v_requests int := 0;
  v_task_id text;
  v_product_zones text[] := ARRAY['Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone'];
  vz text;
BEGIN
  FOREACH vz IN ARRAY v_product_zones
  LOOP
    FOR r IN
      SELECT DISTINCT sku FROM pallets WHERE current_zone = vz
        AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
    LOOP
      v_pct := get_zone_stock_pct(vz, r.sku);

      IF v_pct < 10 THEN
        v_task_id := generate_replenishment_task_id();
        INSERT INTO replenishment_tasks (
          task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
          status, task_type, trigger_reason, priority
        ) VALUES (
          v_task_id, NULL, NULL, r.sku, 1, 'Receiving Area', vz,
          'PENDING', 'ZONE_REPLENISH', 'ZONE_BELOW_10PCT', 2
        );
        v_requests := v_requests + 1;
      ELSIF v_pct < 30 THEN
        INSERT INTO replenishment_warnings (zone, sku, stock_pct)
        VALUES (vz, r.sku, v_pct)
        ON CONFLICT DO NOTHING;  -- (zone, sku) unique would need to be added for upsert
        v_warnings := v_warnings + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'warnings', v_warnings, 'requests', v_requests);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix: replenishment_warnings has no unique on (zone,sku). Use simple insert; duplicate warnings are ok for audit.
-- Remove ON CONFLICT - table has no unique constraint on zone+sku. Keep as INSERT.

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. check_order_availability(order_id)
-- For each line: SM enough? else home zone? create tasks hierarchically
-- Returns: { success, tasks_created[], can_release, message }
-- item_code maps to sku (assume item_code = sku for now)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_order_availability(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  v_sm_qty numeric;
  v_home_qty numeric;
  v_home_zone text;
  v_shortfall numeric;
  v_task_id text;
  v_tasks jsonb := '[]'::jsonb;
  v_can_release boolean := true;
  v_priority int := 10;
BEGIN
  FOR r IN
    SELECT ol.id, ol.item_code, ol.quantity, ol.status
    FROM order_lines ol
    WHERE ol.order_id = p_order_id AND ol.status = 'OPEN'
  LOOP
    v_sm_qty := (get_stock_by_zone_sku('SuperMarket Area', r.item_code)->>'total_qty')::numeric;
    IF v_sm_qty >= r.quantity THEN
      CONTINUE;  -- SM has enough
    END IF;

    v_shortfall := r.quantity - v_sm_qty;
    SELECT home_zone INTO v_home_zone FROM skus WHERE sku = r.item_code AND is_active = true LIMIT 1;

    IF v_home_zone IS NULL THEN
      UPDATE order_lines SET status = 'SHORT', short_quantity = r.quantity WHERE id = r.id;
      v_can_release := false;
      CONTINUE;
    END IF;

    v_home_qty := (get_stock_by_zone_sku(v_home_zone, r.item_code)->>'total_qty')::numeric;

    IF v_home_qty >= v_shortfall THEN
      v_task_id := generate_replenishment_task_id();
      INSERT INTO replenishment_tasks (
        task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
        status, task_type, trigger_reason, priority
      ) VALUES (
        v_task_id, p_order_id, r.id, r.item_code, v_shortfall, v_home_zone, 'SuperMarket Area',
        'PENDING', 'ORDER_PICK', 'ORDER_LINE', v_priority
      );
      v_priority := v_priority + 1;
      v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', v_shortfall);
    ELSE
      v_task_id := generate_replenishment_task_id();
      INSERT INTO replenishment_tasks (
        task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
        status, task_type, trigger_reason, priority
      ) VALUES (
        v_task_id, p_order_id, r.id, r.item_code, v_shortfall, 'Receiving Area', v_home_zone,
        'PENDING', 'ZONE_REPLENISH', 'ORDER_LINE', v_priority
      );
      v_priority := v_priority + 1;
      v_tasks := v_tasks || jsonb_build_object('task_id', v_task_id, 'sku', r.item_code, 'qty', v_shortfall, 'zone_replenish', true);
      UPDATE order_lines SET status = 'SHORT', short_quantity = r.quantity WHERE id = r.id;
      v_can_release := false;
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
    'message', CASE WHEN v_can_release THEN 'All lines available in SM' ELSE 'Replenishment tasks created; some lines need zone replenishment' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Grant execute to anon
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION get_stock_by_zone_sku(text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_sm_target(text) TO anon;
GRANT EXECUTE ON FUNCTION get_zone_stock_pct(text, text) TO anon;
GRANT EXECUTE ON FUNCTION zone_has_capacity(text, int) TO anon;
GRANT EXECUTE ON FUNCTION get_fifo_pallet_for_zone_sku(text, text) TO anon;
GRANT EXECUTE ON FUNCTION check_sm_replenishment() TO anon;
GRANT EXECUTE ON FUNCTION check_zone_replenishment() TO anon;
GRANT EXECUTE ON FUNCTION check_order_availability(uuid) TO anon;
