-- RetiFlux™ — Continuous pull replenishment (zones + SuperMarket in one cycle)
-- Run this after RUN_REPLENISHMENT_WAVE_PER_ZONE.sql

CREATE OR REPLACE FUNCTION run_sm_replenishment_wave(p_per_source_zone_limit int DEFAULT 20)
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  v_pal RECORD;
  v_task_id text;
  v_wave_id text := 'SMWAVE-' || to_char(now(), 'YYYYMMDD-HH24MISS');
  v_created int := 0;
  v_limit int := GREATEST(1, COALESCE(p_per_source_zone_limit, 20));
  v_current_from_zone text := null;
  v_zone_task_count int := 0;
  v_remaining_deficit numeric := 0;
  v_lane_seq int := 0;
  v_lane_total int := 0;
  v_lane_key text;
  v_try int := 0;
BEGIN
  FOR r IN
    WITH home_sku AS (
      SELECT DISTINCT s.home_zone AS from_zone, s.sku
      FROM skus s
      WHERE s.is_active = true
        AND NULLIF(trim(COALESCE(s.home_zone, '')), '') IS NOT NULL
        AND s.home_zone IN ('Detergents Zone', 'Fats Zone', 'Liquids/Oils Zone', 'Soaps Zone', 'Foods & Beverages Zone')
    ),
    zone_qty AS (
      SELECT
        hs.from_zone,
        hs.sku,
        COALESCE(SUM(CASE
          WHEN p.current_zone = hs.from_zone
            AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
          THEN COALESCE(p.remaining_quantity, p.quantity, 0)
          ELSE 0
        END), 0)::numeric AS source_qty
      FROM home_sku hs
      LEFT JOIN pallets p ON p.sku = hs.sku
      GROUP BY hs.from_zone, hs.sku
    ),
    sm_qty AS (
      SELECT
        p.sku,
        COALESCE(SUM(COALESCE(p.remaining_quantity, p.quantity, 0)), 0)::numeric AS supermarket_qty
      FROM pallets p
      WHERE p.current_zone = 'SuperMarket Area'
        AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
      GROUP BY p.sku
    ),
    queued AS (
      SELECT
        rt.from_zone,
        rt.sku,
        COALESCE(SUM(rt.quantity_needed), 0)::numeric AS queued_qty
      FROM replenishment_tasks rt
      WHERE rt.status IN ('PENDING', 'IN_PROGRESS')
        AND rt.task_type = 'SM_REPLENISH'
        AND rt.to_zone = 'SuperMarket Area'
      GROUP BY rt.from_zone, rt.sku
    ),
    deficits AS (
      SELECT
        z.from_zone,
        z.sku,
        z.source_qty,
        COALESCE(s.supermarket_qty, 0)::numeric AS supermarket_qty,
        COALESCE(q.queued_qty, 0)::numeric AS queued_qty,
        CEIL(z.source_qty * 0.30)::numeric AS target_sm_qty,
        GREATEST(0, CEIL(z.source_qty * 0.30) - COALESCE(s.supermarket_qty, 0) - COALESCE(q.queued_qty, 0))::numeric AS deficit_qty
      FROM zone_qty z
      LEFT JOIN sm_qty s ON s.sku = z.sku
      LEFT JOIN queued q ON q.from_zone = z.from_zone AND q.sku = z.sku
      WHERE z.source_qty > 0
    ),
    ranked AS (
      SELECT
        d.from_zone,
        d.sku,
        d.deficit_qty,
        ROW_NUMBER() OVER (PARTITION BY d.from_zone ORDER BY d.deficit_qty DESC, d.sku) AS zone_rank
      FROM deficits d
      WHERE d.deficit_qty > 0
    )
    SELECT from_zone, sku, deficit_qty
    FROM ranked
    WHERE zone_rank <= v_limit
    ORDER BY from_zone, zone_rank, sku
  LOOP
    IF v_current_from_zone IS DISTINCT FROM r.from_zone THEN
      v_current_from_zone := r.from_zone;
      v_zone_task_count := 0;
    END IF;
    IF v_zone_task_count >= v_limit THEN
      CONTINUE;
    END IF;

    v_remaining_deficit := GREATEST(0, COALESCE(r.deficit_qty, 0));
    IF v_remaining_deficit <= 0 THEN
      CONTINUE;
    END IF;

    v_lane_key := COALESCE(r.from_zone, '') || '|SuperMarket Area|' || COALESCE(r.sku, '');
    v_lane_seq := 0;
    v_lane_total := 0;

    FOR v_pal IN
      SELECT COALESCE(p1.remaining_quantity, p1.quantity, 0)::numeric AS pallet_qty
      FROM pallets p1
      WHERE p1.sku = r.sku
        AND p1.current_zone = r.from_zone
        AND (p1.in_transit_to_zone IS NULL OR trim(p1.in_transit_to_zone) = '')
        AND COALESCE(p1.remaining_quantity, p1.quantity, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM replenishment_tasks rt
          WHERE rt.status IN ('PENDING', 'IN_PROGRESS')
            AND rt.task_type = 'SM_REPLENISH'
            AND rt.reserved_pallet_id = p1.pallet_id
        )
      ORDER BY p1.created_at ASC, p1.pallet_id ASC
    LOOP
      EXIT WHEN v_remaining_deficit <= 0;
      EXIT WHEN v_zone_task_count + v_lane_total >= v_limit;
      v_lane_total := v_lane_total + 1;
      v_remaining_deficit := v_remaining_deficit - v_pal.pallet_qty;
    END LOOP;

    v_remaining_deficit := GREATEST(0, COALESCE(r.deficit_qty, 0));
    IF v_lane_total <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_pal IN
      SELECT
        p1.pallet_id,
        COALESCE(p1.remaining_quantity, p1.quantity, 0)::numeric AS pallet_qty
      FROM pallets p1
      WHERE p1.sku = r.sku
        AND p1.current_zone = r.from_zone
        AND (p1.in_transit_to_zone IS NULL OR trim(p1.in_transit_to_zone) = '')
        AND COALESCE(p1.remaining_quantity, p1.quantity, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM replenishment_tasks rt
          WHERE rt.status IN ('PENDING', 'IN_PROGRESS')
            AND rt.task_type = 'SM_REPLENISH'
            AND rt.reserved_pallet_id = p1.pallet_id
        )
      ORDER BY p1.created_at ASC, p1.pallet_id ASC
    LOOP
      EXIT WHEN v_remaining_deficit <= 0;
      EXIT WHEN v_zone_task_count >= v_limit;
      EXIT WHEN v_lane_seq >= v_lane_total;
      v_lane_seq := v_lane_seq + 1;

      v_try := 0;
      LOOP
        v_try := v_try + 1;
        v_task_id := 'REPL-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISSMS') || '-' || lpad(floor(random() * 1000000)::text, 6, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM replenishment_tasks rt WHERE rt.task_id = v_task_id);
        IF v_try > 20 THEN
          RAISE EXCEPTION 'Unable to generate unique SM replenishment task_id after % attempts', v_try;
        END IF;
      END LOOP;

      INSERT INTO replenishment_tasks (
        task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
        status, task_type, trigger_reason, priority, reserved_pallet_id, notes,
        wave_id, lane_key, lane_seq, lane_total
      ) VALUES (
        v_task_id, NULL, NULL, r.sku, v_pal.pallet_qty, r.from_zone, 'SuperMarket Area',
        'PENDING', 'SM_REPLENISH', 'SM_BELOW_10PCT', 1, v_pal.pallet_id, 'AUTO_SM_WAVE_FIFO_FULL_PALLET',
        v_wave_id, v_lane_key, v_lane_seq, v_lane_total
      );

      v_created := v_created + 1;
      v_zone_task_count := v_zone_task_count + 1;
      v_remaining_deficit := v_remaining_deficit - v_pal.pallet_qty;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'per_source_zone_limit', v_limit,
    'requests', v_created
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION run_sm_replenishment_wave(int) TO anon;

CREATE OR REPLACE FUNCTION check_zone_replenishment()
RETURNS jsonb AS $$
DECLARE
  v_zone jsonb;
  v_sm jsonb;
  v_warn int := 0;
BEGIN
  -- Continuous pull: run both waves every cycle.
  v_zone := run_replenishment_wave(20);
  v_sm := run_sm_replenishment_wave(20);
  v_warn := run_replenishment_warnings();

  RETURN jsonb_build_object(
    'success', true,
    'warnings', v_warn,
    'zone_requests', COALESCE((v_zone->>'requests')::int, 0),
    'sm_requests', COALESCE((v_sm->>'requests')::int, 0),
    'requests', COALESCE((v_zone->>'requests')::int, 0) + COALESCE((v_sm->>'requests')::int, 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_zone_replenishment() TO anon;

-- Verify:
-- SELECT check_zone_replenishment();
-- SELECT * FROM get_replenishment_lanes_live('SuperMarket Area') LIMIT 200;
