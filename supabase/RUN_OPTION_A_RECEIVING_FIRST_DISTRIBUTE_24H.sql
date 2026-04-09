-- RetiFlux™ — Option A (Receiving-first) WH reseed + fan-out movements (24h)
-- Creates pallets in `Receiving Area`, then moves them to:
--   - each SKU's home_zone (product zones)
--   - `SuperMarket Area` (SM)
-- Movement timestamps are spread across the last 24 hours for traffic-center "Recent Movements".
-- Also reseeds forklifts so FL icons appear.
--
-- After this script, reinsert/reseed orders (e.g. RUN_SEED_30_TEST_ORDERS.sql)
-- and run the normal order release flow to create order-driven replenishment tasks.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A) Transactional reset (keep master/config tables)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_apply boolean := true;
  v_sql text;
BEGIN
  WITH keep AS (
    SELECT unnest(ARRAY[
      'authorized_users',
      'forklifts',
      'sku_zone_mapping',
      'skus',
      'zone_config',
      'zone_transitions'
    ]) AS table_name
  )
  SELECT
    CASE
      WHEN COUNT(*) = 0 THEN NULL
      ELSE 'TRUNCATE TABLE ' ||
        string_agg(format('%I.%I', t.table_schema, t.table_name), ', ' ORDER BY t.table_name) ||
        ' RESTART IDENTITY CASCADE;'
    END
  INTO v_sql
  FROM information_schema.tables t
  LEFT JOIN keep k ON k.table_name = t.table_name
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND k.table_name IS NULL;

  IF v_sql IS NULL THEN
    RAISE NOTICE 'Transactional reset: nothing to truncate.';
    RETURN;
  END IF;

  IF v_apply THEN
    EXECUTE v_sql;
  ELSE
    RAISE NOTICE 'Transactional reset dry-run only (v_apply=false).';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) Forklift reseed + capacity model
-- ─────────────────────────────────────────────────────────────────────────────
-- Forklifts
INSERT INTO forklifts (forklift_code, name, status) VALUES
  ('FL-320', 'Forklift 320', 'available'),
  ('FL-321', 'Forklift 321', 'available'),
  ('FL-322', 'Forklift 322', 'available'),
  ('FL-323', 'Forklift 323', 'available'),
  ('FL-324', 'Forklift 324', 'available'),
  ('FL-325', 'Forklift 325', 'available'),
  ('FL-326', 'Dispatch FL 326', 'available'),
  ('FL-327', 'Dispatch FL 327', 'available')
ON CONFLICT (forklift_code) DO UPDATE
  SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();

-- Important: forklift availability notifications are only created on
-- status transition busy -> available (see trg_forklifts_notify_available).
-- Since this seed runs after a transactional reset that truncates notifications,
-- force the transition so clerks can see the available FL cards immediately.
-- Force busy -> available ONLY for warehouse fleet.
-- Dispatch fleet forklifts should not show as "available" during this receiving-first distribution.
UPDATE forklifts
SET status = 'busy',
  updated_at = now()
WHERE forklift_code IN ('FL-320','FL-321','FL-322','FL-323','FL-324','FL-325');

-- Keep dispatch fleet non-available (avoid FORKLIFT_AVAILABLE notifications)
-- and keep them parked visually at Dispatch Loading Area.
UPDATE forklifts
SET status = 'busy',
  updated_at = now()
WHERE forklift_code IN ('FL-326','FL-327');

UPDATE forklifts
SET status = 'available',
  updated_at = now()
WHERE forklift_code IN ('FL-320','FL-321','FL-322','FL-323','FL-324','FL-325');

-- Capacities: 7,500 base capped (excluding receiving/outbonded/SM) and SM=30% of base (~2,250)
DO $$
DECLARE
  v_base_capacity int := 7500;
  v_sm_ratio numeric := 0.30;
  v_sm_capacity int;
  v_sum_alloc int;
  v_dispatch_target int;
BEGIN
  v_sm_capacity := CEIL(v_base_capacity * v_sm_ratio)::int;

  UPDATE zone_config
  SET max_capacity = NULL, updated_at = now()
  WHERE zone_name IN ('Receiving Area', 'Outbonded');

  UPDATE zone_config
  SET max_capacity = v_sm_capacity, updated_at = now()
  WHERE zone_name = 'SuperMarket Area';

  WITH seed_weights AS (
    SELECT *
    FROM (VALUES
      ('Detergents Zone',        0.20::numeric),
      ('Fats Zone',              0.20::numeric),
      ('Liquids/Oils Zone',      0.22::numeric),
      ('Soaps Zone',             0.18::numeric),
      ('Foods & Beverages Zone', 0.14::numeric),
      ('Dispatch Loading Area',  0.01::numeric),
      ('QA Hold',                0.005::numeric),
      ('Rework Zone',            0.005::numeric)
    ) AS t(zone_name, w)
  ),
  alloc AS (
    SELECT zone_name, GREATEST(1, FLOOR(v_base_capacity * w)::int) AS cap
    FROM seed_weights
  )
  UPDATE zone_config z
  SET max_capacity = a.cap, updated_at = now()
  FROM alloc a
  WHERE z.zone_name = a.zone_name;

  -- Ensure exact base total = 7,500 by placing remainder into Dispatch Loading Area
  SELECT COALESCE(SUM(max_capacity), 0) INTO v_sum_alloc
  FROM zone_config
  WHERE zone_name NOT IN ('Receiving Area', 'Outbonded', 'SuperMarket Area')
    AND max_capacity IS NOT NULL;

  IF v_sum_alloc <> v_base_capacity THEN
    SELECT COALESCE(max_capacity, 0) INTO v_dispatch_target
    FROM zone_config
    WHERE zone_name = 'Dispatch Loading Area'
    LIMIT 1;

    UPDATE zone_config
    SET max_capacity = GREATEST(1, v_dispatch_target + (v_base_capacity - v_sum_alloc)),
        updated_at = now()
    WHERE zone_name = 'Dispatch Loading Area';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C) Compute target pallet counts per SKU by final zone
--    Product zones: 5 home zones (based on SKUs.home_zone)
--    SM: SuperMarket Area
-- ─────────────────────────────────────────────────────────────────────────────
WITH home_zones AS (
  SELECT
    z.zone_name AS home_zone,
    z.prefix AS zone_prefix,
    z.max_capacity::int AS zone_cap
  FROM zone_config z
  WHERE z.zone_name IN ('Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone')
),
active_skus_in_home AS (
  SELECT
    s.sku,
    s.home_zone,
    hz.zone_cap,
    hz.zone_prefix
  FROM skus s
  JOIN home_zones hz ON hz.home_zone = s.home_zone
  WHERE s.is_active = true
    AND NULLIF(trim(COALESCE(s.home_zone, '')), '') IS NOT NULL
),
sku_counts AS (
  SELECT
    home_zone,
    zone_prefix,
    zone_cap,
    COUNT(*)::int AS sku_count
  FROM active_skus_in_home
  GROUP BY home_zone, zone_prefix, zone_cap
),
product_alloc AS (
  -- Even split by SKU within each home zone, with remainder distributed by deterministic order.
  SELECT
    a.sku,
    a.home_zone,
    a.zone_prefix,
    a.zone_cap,
    c.sku_count,
    ROW_NUMBER() OVER (PARTITION BY a.home_zone ORDER BY a.sku) AS sku_rn,
    CASE
      WHEN c.sku_count = 0 THEN 0
      ELSE (a.zone_cap / c.sku_count)::int
    END AS base_each
  FROM active_skus_in_home a
  JOIN sku_counts c ON c.home_zone = a.home_zone
),
product_alloc2 AS (
  SELECT
    sku,
    home_zone,
    zone_prefix,
    zone_cap,
    sku_rn,
    base_each,
    sku_count,
    (zone_cap - (base_each * sku_count))::int AS rem_each
  FROM product_alloc
),
product_pallets_by_sku AS (
  SELECT
    sku,
    home_zone,
    zone_prefix,
    (base_each + CASE WHEN sku_rn <= rem_each THEN 1 ELSE 0 END)::int AS product_pallets
  FROM product_alloc2
),
sm_target AS (
  SELECT COALESCE(max_capacity, 0)::int AS sm_pallet_target
  FROM zone_config
  WHERE zone_name = 'SuperMarket Area'
  LIMIT 1
),
sm_init AS (
  SELECT
    p.sku,
    p.product_pallets,
    FLOOR(p.product_pallets / 3.0)::int AS sm_floor,
    (p.product_pallets / 3.0 - FLOOR(p.product_pallets / 3.0))::numeric AS frac_part
  FROM product_pallets_by_sku p
),
sm_reduced AS (
  SELECT
    s.sku,
    s.sm_floor,
    s.frac_part,
    st.sm_pallet_target,
    SUM(s.sm_floor) OVER (ORDER BY s.frac_part DESC, s.product_pallets DESC, s.sku ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS sm_cum
  FROM sm_init s
  CROSS JOIN sm_target st
),
sm_pallets_by_sku AS (
  SELECT
    sku,
    CASE
      WHEN (sm_cum - sm_floor) >= sm_pallet_target THEN 0
      WHEN sm_cum <= sm_pallet_target THEN sm_floor
      ELSE (sm_pallet_target - (sm_cum - sm_floor))
    END::int AS sm_pallets
  FROM sm_reduced
),
receiving_pallets_by_sku AS (
  SELECT
    p.sku,
    p.home_zone,
    p.zone_prefix,
    p.product_pallets + COALESCE(s.sm_pallets, 0) AS receiving_pallets
  FROM product_pallets_by_sku p
  LEFT JOIN sm_pallets_by_sku s ON s.sku = p.sku
)
SELECT 1;

-- Validate forklift count + sku counts (lightweight guards)
DO $$
DECLARE
  v_fls int;
  v_products int;
  v_sms int;
BEGIN
  SELECT COUNT(*) INTO v_fls FROM forklifts;
  IF v_fls <= 0 THEN
    RAISE EXCEPTION 'No forklifts in `forklifts` table; cannot generate FL history.';
  END IF;

  SELECT COALESCE(SUM(p.product_pallets), 0)::int INTO v_products
  FROM (
    WITH home_zones AS (
      SELECT z.zone_name AS home_zone, z.prefix AS zone_prefix, z.max_capacity::int AS zone_cap
      FROM zone_config z
      WHERE z.zone_name IN ('Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone')
    ),
    active_skus_in_home AS (
      SELECT s.sku, s.home_zone, hz.zone_cap, hz.zone_prefix
      FROM skus s
      JOIN home_zones hz ON hz.home_zone = s.home_zone
      WHERE s.is_active = true
        AND NULLIF(trim(COALESCE(s.home_zone, '')), '') IS NOT NULL
    ),
    sku_counts AS (
      SELECT home_zone, zone_prefix, zone_cap, COUNT(*)::int AS sku_count
      FROM active_skus_in_home
      GROUP BY home_zone, zone_prefix, zone_cap
    ),
    product_alloc AS (
      SELECT
        a.sku,
        a.home_zone,
        a.zone_prefix,
        a.zone_cap,
        c.sku_count,
        ROW_NUMBER() OVER (PARTITION BY a.home_zone ORDER BY a.sku) AS sku_rn,
        (a.zone_cap / c.sku_count)::int AS base_each
      FROM active_skus_in_home a
      JOIN sku_counts c ON c.home_zone = a.home_zone
    ),
    product_alloc2 AS (
      SELECT
        sku,
        home_zone,
        zone_prefix,
        zone_cap,
        sku_count,
        sku_rn,
        base_each,
        (zone_cap - (base_each * sku_count))::int AS rem_each
      FROM product_alloc
    )
    SELECT sku, home_zone, zone_prefix,
      (base_each + CASE WHEN sku_rn <= rem_each THEN 1 ELSE 0 END)::int AS product_pallets
    FROM product_alloc2
  ) p;

  SELECT COALESCE(max_capacity, 0)::int INTO v_sms FROM zone_config WHERE zone_name = 'SuperMarket Area' LIMIT 1;

  IF v_products <= 0 THEN
    RAISE EXCEPTION 'Product pallet targets not computed (0 product pallets).';
  END IF;

  IF v_sms <= 0 THEN
    RAISE EXCEPTION 'SM pallet target is not set (<=0).';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D) Insert tickets to create receiving pallets (trigger creates pallets)
-- ─────────────────────────────────────────────────────────────────────────────
WITH home_zones AS (
  SELECT z.zone_name AS home_zone, z.prefix AS zone_prefix, z.max_capacity::int AS zone_cap
  FROM zone_config z
  WHERE z.zone_name IN ('Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone')
),
active_skus_in_home AS (
  SELECT s.sku, s.home_zone, hz.zone_cap, hz.zone_prefix
  FROM skus s
  JOIN home_zones hz ON hz.home_zone = s.home_zone
  WHERE s.is_active = true
    AND NULLIF(trim(COALESCE(s.home_zone, '')), '') IS NOT NULL
),
sku_counts AS (
  SELECT home_zone, zone_prefix, zone_cap, COUNT(*)::int AS sku_count
  FROM active_skus_in_home
  GROUP BY home_zone, zone_prefix, zone_cap
),
product_pallets_by_sku AS (
  SELECT
    a.sku,
    a.home_zone,
    a.zone_prefix,
    a.zone_cap,
    c.sku_count,
    ROW_NUMBER() OVER (PARTITION BY a.home_zone ORDER BY a.sku) AS sku_rn,
    (a.zone_cap / c.sku_count)::int AS base_each,
    (a.zone_cap - ((a.zone_cap / c.sku_count)::int * c.sku_count))::int AS rem_each
  FROM active_skus_in_home a
  JOIN sku_counts c ON c.home_zone = a.home_zone
),
product_pallets_final AS (
  SELECT
    sku,
    home_zone,
    zone_prefix,
    (base_each + CASE WHEN sku_rn <= rem_each THEN 1 ELSE 0 END)::int AS product_pallets
  FROM product_pallets_by_sku
),
sm_target AS (
  SELECT COALESCE(max_capacity, 0)::int AS sm_pallet_target
  FROM zone_config
  WHERE zone_name = 'SuperMarket Area'
  LIMIT 1
),
sm_init AS (
  SELECT
    p.sku,
    p.product_pallets,
    FLOOR(p.product_pallets / 3.0)::int AS sm_floor,
    (p.product_pallets / 3.0 - FLOOR(p.product_pallets / 3.0))::numeric AS frac_part
  FROM product_pallets_final p
),
sm_reduced AS (
  SELECT
    s.sku,
    s.sm_floor,
    s.frac_part,
    st.sm_pallet_target,
    SUM(s.sm_floor) OVER (ORDER BY s.frac_part DESC, s.product_pallets DESC, s.sku ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS sm_cum
  FROM sm_init s
  CROSS JOIN sm_target st
),
sm_pallets_by_sku AS (
  SELECT
    sku,
    CASE
      WHEN (sm_cum - sm_floor) >= sm_pallet_target THEN 0
      WHEN sm_cum <= sm_pallet_target THEN sm_floor
      ELSE (sm_pallet_target - (sm_cum - sm_floor))
    END::int AS sm_pallets
  FROM sm_reduced
),
receiving_pallets_by_sku AS (
  SELECT
    p.sku,
    p.home_zone,
    p.zone_prefix,
    (p.product_pallets + COALESCE(s.sm_pallets, 0))::int AS receiving_pallets,
    p.product_pallets::int AS product_pallets
  FROM product_pallets_final p
  LEFT JOIN sm_pallets_by_sku s ON s.sku = p.sku
),
ticket_rows AS (
  SELECT
    r.sku,
    r.home_zone,
    r.zone_prefix,
    gs.n AS pallet_seq_in_sku,
    r.receiving_pallets,
    r.product_pallets,
    current_date - 30 AS mfg_date,
    ROW_NUMBER() OVER (ORDER BY r.home_zone, r.sku, gs.n) AS serial_n
  FROM receiving_pallets_by_sku r
  JOIN LATERAL generate_series(1, GREATEST(0, r.receiving_pallets)) AS gs(n) ON true
)
INSERT INTO tickets (serial, date, sku, qty, uom)
SELECT
  'PRT' || LPAD(t.serial_n::text, 6, '0') || 'RF' AS serial,
  t.mfg_date AS date,
  t.sku,
  100 AS qty,
  'KAR' AS uom
FROM ticket_rows t;

-- At this point, ticket trigger should have created pallets in `Receiving Area`.

-- ─────────────────────────────────────────────────────────────────────────────
-- E) Partition receiving pallets into product home zones + SM
--    based on row_number per SKU.
-- ─────────────────────────────────────────────────────────────────────────────
WITH home_zones AS (
  SELECT z.zone_name AS home_zone, z.prefix AS zone_prefix, z.max_capacity::int AS zone_cap
  FROM zone_config z
  WHERE z.zone_name IN ('Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone')
),
active_skus_in_home AS (
  SELECT s.sku, s.home_zone, hz.zone_cap, hz.zone_prefix
  FROM skus s
  JOIN home_zones hz ON hz.home_zone = s.home_zone
  WHERE s.is_active = true
    AND NULLIF(trim(COALESCE(s.home_zone, '')), '') IS NOT NULL
),
sku_counts AS (
  SELECT home_zone, zone_prefix, zone_cap, COUNT(*)::int AS sku_count
  FROM active_skus_in_home
  GROUP BY home_zone, zone_prefix, zone_cap
),
product_alloc AS (
  SELECT
    a.sku,
    a.home_zone,
    a.zone_prefix,
    a.zone_cap,
    c.sku_count,
    ROW_NUMBER() OVER (PARTITION BY a.home_zone ORDER BY a.sku) AS sku_rn,
    (a.zone_cap / c.sku_count)::int AS base_each,
    (a.zone_cap - ((a.zone_cap / c.sku_count)::int * c.sku_count))::int AS rem_each
  FROM active_skus_in_home a
  JOIN sku_counts c ON c.home_zone = a.home_zone
),
product_pallets_final AS (
  SELECT
    sku,
    home_zone,
    zone_prefix,
    (base_each + CASE WHEN sku_rn <= rem_each THEN 1 ELSE 0 END)::int AS product_pallets
  FROM product_alloc
),
sm_target AS (
  SELECT COALESCE(max_capacity, 0)::int AS sm_pallet_target
  FROM zone_config
  WHERE zone_name = 'SuperMarket Area'
  LIMIT 1
),
sm_init AS (
  SELECT
    p.sku,
    p.product_pallets,
    FLOOR(p.product_pallets / 3.0)::int AS sm_floor,
    (p.product_pallets / 3.0 - FLOOR(p.product_pallets / 3.0))::numeric AS frac_part
  FROM product_pallets_final p
),
sm_reduced AS (
  SELECT
    s.sku,
    s.sm_floor,
    s.frac_part,
    st.sm_pallet_target,
    SUM(s.sm_floor) OVER (ORDER BY s.frac_part DESC, s.product_pallets DESC, s.sku ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS sm_cum
  FROM sm_init s
  CROSS JOIN sm_target st
),
sm_pallets_by_sku AS (
  SELECT
    sku,
    CASE
      WHEN (sm_cum - sm_floor) >= sm_pallet_target THEN 0
      WHEN sm_cum <= sm_pallet_target THEN sm_floor
      ELSE (sm_pallet_target - (sm_cum - sm_floor))
    END::int AS sm_pallets
  FROM sm_reduced
),
receiving_plan AS (
  SELECT
    p.sku,
    p.home_zone,
    p.zone_prefix,
    p.product_pallets,
    COALESCE(s.sm_pallets, 0)::int AS sm_pallets,
    (p.product_pallets + COALESCE(s.sm_pallets, 0))::int AS total_receiving_pallets
  FROM product_pallets_final p
  LEFT JOIN sm_pallets_by_sku s ON s.sku = p.sku
),
recv_ranked AS (
  SELECT
    p.pallet_id,
    p.sku,
    p.current_zone,
    p.remaining_quantity,
    p.quantity,
    ROW_NUMBER() OVER (PARTITION BY p.sku ORDER BY p.created_at ASC, p.pallet_id ASC) AS rn
  FROM pallets p
  WHERE p.current_zone = 'Receiving Area'
    AND p.in_transit_to_zone IS NULL
    AND p.sku IN (SELECT sku FROM receiving_plan)
),
assignments AS (
  SELECT
    rr.pallet_id,
    rr.sku,
    rp.home_zone,
    rp.zone_prefix,
    rp.product_pallets,
    rp.sm_pallets,
    CASE WHEN rr.rn <= rp.sm_pallets THEN 'SuperMarket Area' ELSE rp.home_zone END AS dest_zone,
    CASE WHEN rr.rn <= rp.sm_pallets THEN 'SM' ELSE rp.zone_prefix END AS dest_prefix,
    rr.remaining_quantity,
    rr.quantity
  FROM recv_ranked rr
  JOIN receiving_plan rp ON rp.sku = rr.sku
)
UPDATE pallets p
SET current_zone = a.dest_zone,
    zone_prefix = a.dest_prefix,
    last_moved_at = now(),
    last_moved_by = 'Auto-Option-A',
    notes = COALESCE(notes, '') || E'\n[Auto-Option-A] Receiving->SM-first distribution (FIFO aligned)'
FROM assignments a
WHERE p.pallet_id = a.pallet_id;

-- Zone occupancy refresh
UPDATE zone_config z
SET current_occupancy = (
  SELECT COUNT(*)
  FROM pallets p
  WHERE p.current_zone = z.zone_name
)
WHERE z.zone_name IN (
  'Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone','SuperMarket Area','Receiving Area'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- F) Insert 24h-spread zone_movements (for traffic-center recent movements + FL icons)
--    We generate one "Received" movement per pallet we moved from Receiving -> destination.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fls int;
  v_total_moves int;
  v_start timestamptz := now() - interval '24 hours';
  v_end timestamptz := now();
  v_step_seconds numeric;
BEGIN
  -- Use ONLY warehouse fleet for Receiving->zone distribution moves.
  -- Dispatch fleet should remain visually at Dispatch Loading Area.
  SELECT COUNT(*) INTO v_fls
  FROM forklifts
  WHERE forklift_code IN ('FL-320','FL-321','FL-322','FL-323','FL-324','FL-325');
  IF v_fls <= 0 THEN
    RAISE EXCEPTION 'forklifts table is empty; cannot create FL history.';
  END IF;

  SELECT COUNT(*) INTO v_total_moves
  FROM pallets p
  WHERE p.pallet_id ~ '^PRT[0-9]{6}RF$';

  IF v_total_moves <= 0 THEN
    RAISE EXCEPTION 'No pallets created by this option-A run (expected PRT000000RF pallet ids).';
  END IF;

  v_step_seconds := (EXTRACT(EPOCH FROM (v_end - v_start)) / GREATEST(v_total_moves, 1));

  WITH home_zones AS (
    SELECT z.zone_name AS home_zone, z.prefix AS zone_prefix, z.max_capacity::int AS zone_cap
    FROM zone_config z
    WHERE z.zone_name IN ('Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone')
  ),
  active_skus_in_home AS (
    SELECT s.sku, s.home_zone, hz.zone_cap, hz.zone_prefix
    FROM skus s
    JOIN home_zones hz ON hz.home_zone = s.home_zone
    WHERE s.is_active = true
      AND NULLIF(trim(COALESCE(s.home_zone, '')), '') IS NOT NULL
  ),
  sku_counts AS (
    SELECT home_zone, zone_prefix, zone_cap, COUNT(*)::int AS sku_count
    FROM active_skus_in_home
    GROUP BY home_zone, zone_prefix, zone_cap
  ),
  product_alloc AS (
    SELECT
      a.sku,
      a.home_zone,
      a.zone_prefix,
      a.zone_cap,
      c.sku_count,
      ROW_NUMBER() OVER (PARTITION BY a.home_zone ORDER BY a.sku) AS sku_rn,
      (a.zone_cap / c.sku_count)::int AS base_each,
      (a.zone_cap - ((a.zone_cap / c.sku_count)::int * c.sku_count))::int AS rem_each
    FROM active_skus_in_home a
    JOIN sku_counts c ON c.home_zone = a.home_zone
  ),
  product_pallets_final AS (
    SELECT
      sku,
      home_zone,
      zone_prefix,
      (base_each + CASE WHEN sku_rn <= rem_each THEN 1 ELSE 0 END)::int AS product_pallets
    FROM product_alloc
  ),
  sm_target AS (
    SELECT COALESCE(max_capacity, 0)::int AS sm_pallet_target
    FROM zone_config
    WHERE zone_name = 'SuperMarket Area'
    LIMIT 1
  ),
  sm_init AS (
    SELECT
      p.sku,
      p.product_pallets,
      FLOOR(p.product_pallets / 3.0)::int AS sm_floor,
      (p.product_pallets / 3.0 - FLOOR(p.product_pallets / 3.0))::numeric AS frac_part
    FROM product_pallets_final p
  ),
  sm_reduced AS (
    SELECT
      s.sku,
      s.sm_floor,
      s.frac_part,
      st.sm_pallet_target,
      SUM(s.sm_floor) OVER (ORDER BY s.frac_part DESC, s.product_pallets DESC, s.sku ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS sm_cum
    FROM sm_init s
    CROSS JOIN sm_target st
  ),
  sm_pallets_by_sku AS (
    SELECT
      sku,
      CASE
        WHEN (sm_cum - sm_floor) >= sm_pallet_target THEN 0
        WHEN sm_cum <= sm_pallet_target THEN sm_floor
        ELSE (sm_pallet_target - (sm_cum - sm_floor))
      END::int AS sm_pallets
    FROM sm_reduced
  ),
  receiving_plan AS (
    SELECT
      p.sku,
      p.home_zone,
      p.zone_prefix,
      p.product_pallets,
      COALESCE(s.sm_pallets, 0)::int AS sm_pallets
    FROM product_pallets_final p
    LEFT JOIN sm_pallets_by_sku s ON s.sku = p.sku
  ),
  moved AS (
    SELECT
      p.pallet_id,
      p.sku,
      p.current_zone AS dest_zone,
      -- Align fan-out chronology with FIFO chronology used by picker/allocation.
      ROW_NUMBER() OVER (ORDER BY p.created_at ASC, p.pallet_id ASC) AS move_seq
    FROM pallets p
    WHERE p.pallet_id ~ '^PRT[0-9]{6}RF$'
  ),
  fl AS (
    SELECT
      f.id,
      f.forklift_code,
      ROW_NUMBER() OVER (ORDER BY f.forklift_code) AS rn,
      COUNT(*) OVER () AS cnt
    FROM forklifts f
    WHERE f.forklift_code IN ('FL-320','FL-321','FL-322','FL-323','FL-324','FL-325')
  )
  INSERT INTO zone_movements (
    movement_id,
    pallet_id,
    from_zone,
    to_zone,
    movement_date,
    movement_time,
    moved_by,
    reason,
    override_reason,
    quantity,
    order_reference,
    notes,
    created_at,
    movement_status,
    received_at,
    received_by,
    forklift_id
  )
  SELECT
    'MOV-OPT-A-' || m.pallet_id AS movement_id,
    m.pallet_id,
    'Receiving Area' AS from_zone,
    m.dest_zone AS to_zone,
    (v_start + (m.move_seq - 1) * v_step_seconds * interval '1 second')::date AS movement_date,
    (v_start + (m.move_seq - 1) * v_step_seconds * interval '1 second')::time AS movement_time,
    'Auto-Option-A' AS moved_by,
    NULL AS reason,
    NULL AS override_reason,
    COALESCE(p.remaining_quantity, p.quantity, 0) AS quantity,
    NULL AS order_reference,
    'Auto Option-A distribute' AS notes,
    (v_start + (m.move_seq - 1) * v_step_seconds * interval '1 second') AS created_at,
    'Received' AS movement_status,
    (v_start + (m.move_seq - 1) * v_step_seconds * interval '1 second') + interval '30 seconds' AS received_at,
    'system' AS received_by,
    fl.id AS forklift_id
  FROM moved m
  JOIN pallets p ON p.pallet_id = m.pallet_id
  JOIN fl ON fl.rn = ((m.move_seq - 1) % fl.cnt) + 1;

END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- G) Stock baseline report (zone_stock_baseline)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO zone_stock_baseline (zone, sku, baseline_pallets, baseline_qty, updated_at)
SELECT
  p.current_zone AS zone,
  p.sku,
  COUNT(*)::int AS baseline_pallets,
  COALESCE(SUM(COALESCE(p.remaining_quantity, p.quantity, 0)), 0)::numeric AS baseline_qty,
  now()
FROM pallets p
WHERE p.sku IS NOT NULL
GROUP BY p.current_zone, p.sku
ON CONFLICT (zone, sku) DO UPDATE SET
  baseline_pallets = EXCLUDED.baseline_pallets,
  baseline_qty = EXCLUDED.baseline_qty,
  updated_at = EXCLUDED.updated_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- H) Report: SKU x Effective Zone totals
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COALESCE(NULLIF(trim(p.in_transit_to_zone), ''), p.current_zone) AS effective_zone,
  p.sku,
  COUNT(*) AS pallet_count,
  SUM(COALESCE(p.remaining_quantity, p.quantity, 0))::numeric AS total_qty_units
FROM pallets p
WHERE p.sku IS NOT NULL
GROUP BY 1, p.sku
ORDER BY effective_zone, p.sku;

SELECT
  COALESCE(NULLIF(trim(in_transit_to_zone), ''), current_zone) AS effective_zone,
  COUNT(*) AS pallet_count,
  SUM(COALESCE(remaining_quantity, quantity, 0))::numeric AS total_qty_units
FROM pallets
WHERE sku IS NOT NULL
GROUP BY 1
ORDER BY effective_zone;

COMMIT;

