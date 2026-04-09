-- RetiFlux™ — Fix zone replenishment generation for empty zones
-- Problem:
--   Old check_zone_replenishment() only iterates SKUs currently present in each zone.
--   If a zone is empty, no SKUs are inspected, so no warning/task is created.
--
-- This fix iterates active SKUs by their home_zone instead, so empty zones still trigger requests.
--
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION check_zone_replenishment()
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  v_pct numeric;
  v_warnings int := 0;
  v_requests int := 0;
  v_task_id text;
BEGIN
  FOR r IN
    SELECT s.home_zone AS zone_name, s.sku
    FROM skus s
    WHERE s.is_active = true
      AND s.home_zone IN ('Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone')
  LOOP
    v_pct := COALESCE(get_zone_stock_pct(r.zone_name, r.sku), 0);

    IF v_pct < 10 THEN
      -- Avoid duplicate open requests for same zone+sku class.
      IF NOT EXISTS (
        SELECT 1
        FROM replenishment_tasks rt
        WHERE rt.status IN ('PENDING', 'IN_PROGRESS')
          AND rt.task_type = 'ZONE_REPLENISH'
          AND rt.from_zone = 'Receiving Area'
          AND rt.to_zone = r.zone_name
          AND rt.sku = r.sku
      ) THEN
        v_task_id := generate_replenishment_task_id();
        INSERT INTO replenishment_tasks (
          task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
          status, task_type, trigger_reason, priority
        ) VALUES (
          v_task_id, NULL, NULL, r.sku, 1, 'Receiving Area', r.zone_name,
          'PENDING', 'ZONE_REPLENISH', 'ZONE_BELOW_10PCT', 2
        );
        v_requests := v_requests + 1;
      END IF;
    ELSIF v_pct < 30 THEN
      INSERT INTO replenishment_warnings (zone, sku, stock_pct)
      VALUES (r.zone_name, r.sku, v_pct);
      v_warnings := v_warnings + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'warnings', v_warnings, 'requests', v_requests);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_zone_replenishment() TO anon;

-- Quick verification:
-- SELECT check_zone_replenishment();
-- SELECT task_id, from_zone, to_zone, sku, task_type, trigger_reason, status
-- FROM replenishment_tasks
-- WHERE status = 'PENDING'
--   AND task_type = 'ZONE_REPLENISH'
-- ORDER BY created_at DESC
-- LIMIT 100;
-- RetiFlux™ — Fix zone replenishment generation for empty zones
-- Problem:
--   Existing check_zone_replenishment() loops SKUs from pallets already in-zone,
--   so fully empty zones produce no rows and no replenishment requests.
--
-- This version scans active SKUs by home_zone so empty zones still trigger tasks.
-- Safe behavior:
--   - Creates at most one pending/in-progress ZONE_REPLENISH task per (to_zone, sku)
--   - Keeps warning events for 10-30% stock
--   - Uses Receiving Area as source for zone fill

CREATE OR REPLACE FUNCTION check_zone_replenishment()
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  v_pct numeric;
  v_warnings int := 0;
  v_requests int := 0;
  v_task_id text;
BEGIN
  FOR r IN
    SELECT DISTINCT
      s.home_zone AS zone_name,
      s.sku
    FROM skus s
    WHERE s.is_active = true
      AND NULLIF(trim(COALESCE(s.home_zone, '')), '') IS NOT NULL
      AND s.home_zone NOT IN ('Receiving Area', 'SuperMarket Area', 'Dispatch Loading Area', 'QA Hold', 'Rework Zone')
  LOOP
    v_pct := COALESCE(get_zone_stock_pct(r.zone_name, r.sku), 0);

    IF v_pct < 10 THEN
      IF NOT EXISTS (
        SELECT 1
        FROM replenishment_tasks rt
        WHERE rt.status IN ('PENDING', 'IN_PROGRESS')
          AND rt.task_type = 'ZONE_REPLENISH'
          AND rt.to_zone = r.zone_name
          AND rt.sku = r.sku
      ) THEN
        v_task_id := generate_replenishment_task_id();
        INSERT INTO replenishment_tasks (
          task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
          status, task_type, trigger_reason, priority
        ) VALUES (
          v_task_id, NULL, NULL, r.sku, 1, 'Receiving Area', r.zone_name,
          'PENDING', 'ZONE_REPLENISH', 'ZONE_BELOW_10PCT', 2
        );
        v_requests := v_requests + 1;
      END IF;
    ELSIF v_pct < 30 THEN
      INSERT INTO replenishment_warnings (zone, sku, stock_pct)
      VALUES (r.zone_name, r.sku, v_pct);
      v_warnings := v_warnings + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'warnings', v_warnings,
    'requests', v_requests
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_zone_replenishment() TO anon;

-- Optional verification:
-- SELECT check_zone_replenishment();
-- SELECT status, task_type, from_zone, to_zone, sku, COUNT(*) AS n
-- FROM replenishment_tasks
-- WHERE status IN ('PENDING','IN_PROGRESS')
-- GROUP BY status, task_type, from_zone, to_zone, sku
-- ORDER BY n DESC, task_type, to_zone, sku
-- LIMIT 200;
