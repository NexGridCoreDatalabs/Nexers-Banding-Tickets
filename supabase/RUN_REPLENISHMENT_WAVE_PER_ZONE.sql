-- RetiFlux™ — Replenishment wave with per-zone cap + pallet-explicit tasks
-- Goal:
--   Create replenishment tasks "live" across all product zones with a cap per zone.
--
-- Rule implemented here:
--   - Source: Receiving Area
--   - Target: SKU home_zone (product zones only)
--   - Compute deficit quantity per SKU using distribution-aware 10% floor:
--       target_qty = CEIL(receiving_qty_for_sku * 10%)
--       deficit_qty = target_qty - current_qty_in_home_zone - queued_open_qty
--   - Create pallet-explicit tasks (reserved_pallet_id) using FIFO from Receiving
--   - Full pallets only for inter-zone movement (no splits outside SM)
--   - Per-run cap: up to p_per_zone_limit tasks per zone (default 20)
--   - Dedupe: avoid reusing a pallet already in open replenishment task
--
-- Notes:
--   - quantity_needed = full pallet qty for each listed pallet task.
--   - A "residual" deficit is satisfied by moving the next full FIFO pallet.

-- Ensure tracking columns exist for lane-level progress (x/y moved pallets)
ALTER TABLE replenishment_tasks
  ADD COLUMN IF NOT EXISTS wave_id text,
  ADD COLUMN IF NOT EXISTS lane_key text,
  ADD COLUMN IF NOT EXISTS lane_seq integer,
  ADD COLUMN IF NOT EXISTS lane_total integer;

CREATE INDEX IF NOT EXISTS replenishment_tasks_wave_idx ON replenishment_tasks(wave_id);
CREATE INDEX IF NOT EXISTS replenishment_tasks_lane_key_idx ON replenishment_tasks(lane_key);

CREATE OR REPLACE FUNCTION run_replenishment_wave(p_per_zone_limit int DEFAULT 20)
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  v_pal RECORD;
  v_task_id text;
  v_wave_id text := 'WAVE-' || to_char(now(), 'YYYYMMDD-HH24MISS');
  v_created int := 0;
  v_per_zone_limit int := GREATEST(1, COALESCE(p_per_zone_limit, 20));
  v_zone_task_count int := 0;
  v_current_zone text := null;
  v_remaining_deficit numeric := 0;
  v_lane_seq int := 0;
  v_lane_total int := 0;
  v_lane_key text;
  v_try int := 0;
BEGIN
  FOR r IN
    WITH receiving_sku AS (
      SELECT
        s.home_zone AS to_zone,
        s.sku,
        COALESCE(SUM(CASE
          WHEN pl.current_zone = 'Receiving Area'
            AND (pl.in_transit_to_zone IS NULL OR trim(pl.in_transit_to_zone) = '')
          THEN COALESCE(pl.remaining_quantity, pl.quantity, 0)
          ELSE 0
        END), 0)::numeric AS receiving_qty
      FROM skus s
      LEFT JOIN pallets pl ON pl.sku = s.sku
      WHERE s.is_active = true
        AND NULLIF(trim(COALESCE(s.home_zone, '')), '') IS NOT NULL
        AND s.home_zone IN ('Detergents Zone', 'Fats Zone', 'Liquids/Oils Zone', 'Soaps Zone', 'Foods & Beverages Zone')
      GROUP BY s.home_zone, s.sku
    ),
    zone_sku AS (
      SELECT
        rs.to_zone,
        rs.sku,
        rs.receiving_qty,
        COALESCE(SUM(CASE
          WHEN pl2.current_zone = rs.to_zone
            AND (pl2.in_transit_to_zone IS NULL OR trim(pl2.in_transit_to_zone) = '')
          THEN COALESCE(pl2.remaining_quantity, pl2.quantity, 0)
          ELSE 0
        END), 0)::numeric AS zone_qty
      FROM receiving_sku rs
      LEFT JOIN pallets pl2 ON pl2.sku = rs.sku
      GROUP BY rs.to_zone, rs.sku, rs.receiving_qty
    ),
    queued AS (
      SELECT
        rt.to_zone,
        rt.sku,
        COALESCE(SUM(rt.quantity_needed), 0)::numeric AS queued_qty
      FROM replenishment_tasks rt
      WHERE rt.status IN ('PENDING', 'IN_PROGRESS')
        AND rt.task_type = 'ZONE_REPLENISH'
        AND rt.from_zone = 'Receiving Area'
      GROUP BY rt.to_zone, rt.sku
    ),
    deficits AS (
      SELECT
        zs.to_zone,
        zs.sku,
        zs.receiving_qty,
        zs.zone_qty,
        COALESCE(q.queued_qty, 0)::numeric AS queued_qty,
        GREATEST(0, CEIL(zs.receiving_qty * 0.10) - zs.zone_qty - COALESCE(q.queued_qty, 0))::numeric AS deficit_qty
      FROM zone_sku zs
      LEFT JOIN queued q
        ON q.to_zone = zs.to_zone
       AND q.sku = zs.sku
      WHERE zs.receiving_qty > 0
    ),
    candidates AS (
      SELECT
        d.to_zone,
        d.sku,
        d.deficit_qty,
        ROW_NUMBER() OVER (
          PARTITION BY d.to_zone
          ORDER BY d.deficit_qty DESC, d.sku
        ) AS zone_rank
      FROM deficits d
      WHERE d.sku IS NOT NULL
        AND d.deficit_qty > 0
    )
    SELECT to_zone, sku, deficit_qty
    FROM candidates
    WHERE zone_rank <= v_per_zone_limit
    ORDER BY to_zone, zone_rank, sku
  LOOP
    IF v_current_zone IS DISTINCT FROM r.to_zone THEN
      v_current_zone := r.to_zone;
      v_zone_task_count := 0;
    END IF;
    IF v_zone_task_count >= v_per_zone_limit THEN
      CONTINUE;
    END IF;

    v_remaining_deficit := GREATEST(0, COALESCE(r.deficit_qty, 0));
    IF v_remaining_deficit <= 0 THEN
      CONTINUE;
    END IF;
    v_lane_key := 'Receiving Area|' || COALESCE(r.to_zone, '') || '|' || COALESCE(r.sku, '');
    v_lane_seq := 0;
    v_lane_total := 0;

    -- Pre-count how many FIFO pallets will be needed (bounded by zone cap remaining)
    FOR v_pal IN
      SELECT COALESCE(p1.remaining_quantity, p1.quantity, 0)::numeric AS pallet_qty
      FROM pallets p1
      WHERE p1.sku = r.sku
        AND p1.current_zone = 'Receiving Area'
        AND (p1.in_transit_to_zone IS NULL OR trim(p1.in_transit_to_zone) = '')
        AND COALESCE(p1.remaining_quantity, p1.quantity, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM replenishment_tasks rt
          WHERE rt.status IN ('PENDING', 'IN_PROGRESS')
            AND rt.task_type = 'ZONE_REPLENISH'
            AND rt.reserved_pallet_id = p1.pallet_id
        )
      ORDER BY p1.created_at ASC, p1.pallet_id ASC
    LOOP
      EXIT WHEN v_remaining_deficit <= 0;
      EXIT WHEN v_zone_task_count + v_lane_total >= v_per_zone_limit;
      v_lane_total := v_lane_total + 1;
      v_remaining_deficit := v_remaining_deficit - v_pal.pallet_qty;
    END LOOP;

    -- reset for actual insert pass
    v_remaining_deficit := GREATEST(0, COALESCE(r.deficit_qty, 0));
    IF v_lane_total <= 0 THEN
      CONTINUE;
    END IF;

    -- Emit pallet-by-pallet tasks (FIFO), full pallets only.
    FOR v_pal IN
      SELECT
        p1.pallet_id,
        COALESCE(p1.remaining_quantity, p1.quantity, 0)::numeric AS pallet_qty
      FROM pallets p1
      WHERE p1.sku = r.sku
        AND p1.current_zone = 'Receiving Area'
        AND (p1.in_transit_to_zone IS NULL OR trim(p1.in_transit_to_zone) = '')
        AND COALESCE(p1.remaining_quantity, p1.quantity, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM replenishment_tasks rt
          WHERE rt.status IN ('PENDING', 'IN_PROGRESS')
            AND rt.task_type = 'ZONE_REPLENISH'
            AND rt.reserved_pallet_id = p1.pallet_id
        )
      ORDER BY p1.created_at ASC, p1.pallet_id ASC
    LOOP
      EXIT WHEN v_remaining_deficit <= 0;
      EXIT WHEN v_zone_task_count >= v_per_zone_limit;
      EXIT WHEN v_lane_seq >= v_lane_total;
      v_lane_seq := v_lane_seq + 1;

      -- Guard against task_id collisions under burst inserts.
      v_try := 0;
      LOOP
        v_try := v_try + 1;
        v_task_id := 'REPL-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISSMS') || '-' || lpad(floor(random() * 1000000)::text, 6, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM replenishment_tasks rt WHERE rt.task_id = v_task_id);
        IF v_try > 20 THEN
          RAISE EXCEPTION 'Unable to generate unique replenishment task_id after % attempts', v_try;
        END IF;
      END LOOP;
      INSERT INTO replenishment_tasks (
        task_id, order_id, order_line_id, sku, quantity_needed, from_zone, to_zone,
        status, task_type, trigger_reason, priority, reserved_pallet_id, notes,
        wave_id, lane_key, lane_seq, lane_total
      ) VALUES (
        v_task_id, NULL, NULL, r.sku, v_pal.pallet_qty, 'Receiving Area', r.to_zone,
        'PENDING', 'ZONE_REPLENISH', 'ZONE_BELOW_10PCT', 2, v_pal.pallet_id,
        'AUTO_WAVE_FIFO_FULL_PALLET',
        v_wave_id, v_lane_key, v_lane_seq, v_lane_total
      );

      v_created := v_created + 1;
      v_zone_task_count := v_zone_task_count + 1;
      v_remaining_deficit := v_remaining_deficit - v_pal.pallet_qty;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'per_zone_limit', v_per_zone_limit,
    'requests', v_created
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION run_replenishment_wave(int) TO anon;

CREATE OR REPLACE FUNCTION run_replenishment_warnings()
RETURNS integer AS $$
DECLARE
  v_warnings int := 0;
BEGIN
  -- 30% warning layer (distribution-aware against receiving-side baseline)
  INSERT INTO replenishment_warnings (zone, sku, stock_pct)
  SELECT
    z.to_zone,
    z.sku,
    CASE
      WHEN z.warn_target_qty <= 0 THEN 0
      ELSE ROUND((z.zone_qty / z.warn_target_qty) * 100.0, 2)
    END AS stock_pct
  FROM (
    WITH receiving_sku AS (
      SELECT
        s.home_zone AS to_zone,
        s.sku,
        COALESCE(SUM(CASE
          WHEN p.current_zone = 'Receiving Area'
            AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
          THEN COALESCE(p.remaining_quantity, p.quantity, 0)
          ELSE 0
        END), 0)::numeric AS receiving_qty
      FROM skus s
      LEFT JOIN pallets p ON p.sku = s.sku
      WHERE s.is_active = true
        AND NULLIF(trim(COALESCE(s.home_zone, '')), '') IS NOT NULL
        AND s.home_zone IN ('Detergents Zone', 'Fats Zone', 'Liquids/Oils Zone', 'Soaps Zone', 'Foods & Beverages Zone')
      GROUP BY s.home_zone, s.sku
    )
    SELECT
      rs.to_zone,
      rs.sku,
      COALESCE(SUM(CASE
        WHEN p2.current_zone = rs.to_zone
          AND (p2.in_transit_to_zone IS NULL OR trim(p2.in_transit_to_zone) = '')
        THEN COALESCE(p2.remaining_quantity, p2.quantity, 0)
        ELSE 0
      END), 0)::numeric AS zone_qty,
      CEIL(rs.receiving_qty * 0.30)::numeric AS warn_target_qty
    FROM receiving_sku rs
    LEFT JOIN pallets p2 ON p2.sku = rs.sku
    WHERE rs.receiving_qty > 0
    GROUP BY rs.to_zone, rs.sku, rs.receiving_qty
  ) z
  WHERE z.warn_target_qty > 0
    AND z.zone_qty < z.warn_target_qty
    AND NOT EXISTS (
      SELECT 1
      FROM replenishment_warnings w
      WHERE w.zone = z.to_zone
        AND w.sku = z.sku
        AND w.acknowledged = false
        AND w.triggered_at >= now() - interval '12 hours'
    );

  GET DIAGNOSTICS v_warnings = ROW_COUNT;
  RETURN v_warnings;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION run_replenishment_warnings() TO anon;

-- Keep existing UI contract: check_zone_replenishment() returns {success,warnings,requests}
CREATE OR REPLACE FUNCTION check_zone_replenishment()
RETURNS jsonb AS $$
DECLARE
  v_res jsonb;
  v_warn int := 0;
BEGIN
  v_res := run_replenishment_wave(20);
  v_warn := run_replenishment_warnings();
  RETURN jsonb_build_object(
    'success', true,
    'warnings', v_warn,
    'requests', COALESCE((v_res->>'requests')::int, 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_zone_replenishment() TO anon;

-- Quick verification
-- SELECT run_replenishment_wave(20);
-- SELECT check_zone_replenishment();
-- SELECT to_zone, COUNT(*) AS pending_tasks
-- FROM replenishment_tasks
-- WHERE status IN ('PENDING','IN_PROGRESS') AND task_type = 'ZONE_REPLENISH'
-- GROUP BY to_zone
-- ORDER BY to_zone;

