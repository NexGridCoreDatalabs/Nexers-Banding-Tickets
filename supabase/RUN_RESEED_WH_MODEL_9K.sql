-- RetiFlux™ — One-shot WH reseed (9K-ish) + SKU stock report
-- Goal:
--   - Reset transactional data (keep only master/config tables as in RUN_STRESS_RESET_TRANSACTIONAL.sql)
--   - Apply the 7k–7.5k capped WH profile:
--       * Product zones total capacity ~= 7,500 pallets
--       * SuperMarket capacity ~= 2,250 pallets (30% of base)
--       * Receiving Area remains uncapped (and is NOT seeded by this script)
--   - Reseed pallets via RUN_SIMULATION_FILL.sql logic
--   - Output a per-zone/per-SKU stock report
--
-- After this script:
--   - Reinsert orders using RUN_SEED_30_TEST_ORDERS.sql (or your production order intake)
--   - Then run order release (picker/zone-clerk workflow generates order-driven replenishment tasks).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A) Transactional reset (keep: authorized_users, forklifts, sku_zone_mapping, skus, zone_config, zone_transitions)
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

  RAISE NOTICE 'Transactional reset: %', v_sql;
  IF v_apply THEN
    EXECUTE v_sql;
    RAISE NOTICE 'Transactional reset completed.';
  ELSE
    RAISE NOTICE 'Transactional reset dry-run only (v_apply=false).';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) Apply curated capacities (7k–7.5k + SM=2250)
--    (copy of RUN_SET_ZONE_CAPACITIES_7K_7P5K.sql core logic)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_base_capacity int := 7500;
  v_sm_ratio numeric := 0.30;
  v_sm_capacity int;
  v_sum_alloc int;
  v_dispatch_target int;
BEGIN
  v_sm_capacity := CEIL(v_base_capacity * v_sm_ratio)::int;

  -- Uncapped zones
  UPDATE zone_config
  SET max_capacity = NULL, updated_at = now()
  WHERE zone_name IN ('Receiving Area', 'Outbonded');

  -- SuperMarket cap
  UPDATE zone_config
  SET max_capacity = v_sm_capacity, updated_at = now()
  WHERE zone_name = 'SuperMarket Area';

  -- Weighted split for capped zones (sum weights = 1.00)
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

  -- Ensure exact base total = 7,500 pallets by placing remainder into Dispatch Loading Area
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
-- C) Reseed pallets (copy of RUN_SIMULATION_FILL.sql with no Receiving seed)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM zone_movements WHERE pallet_id LIKE 'PRT-SIM-%';
DELETE FROM pallets WHERE pallet_id LIKE 'PRT-SIM-%' OR original_ticket_serial LIKE 'PRT-SIM-%';
DELETE FROM tickets WHERE serial LIKE 'PRT-SIM-%';
DELETE FROM zone_stock_baseline;

UPDATE zone_config SET current_occupancy = 0, next_pallet_number = 1;

DROP TRIGGER IF EXISTS trg_create_pallet_from_ticket ON tickets;

DO $$
DECLARE
  v_zones RECORD;
  v_skus RECORD;
  v_pallets_per_sku int;
  v_total int;
  v_count int;
  v_serial text;
  v_prefix text;
  v_zone_name text;
  v_cap int;
  v_occupancy int;
  v_seq int;
  v_sm_count int;
  v_sm_cap int;
  v_sm_occupancy int;
  v_n int;
  v_mfg date;
BEGIN
  v_mfg := current_date - 30;

  -- Product zones
  FOR v_zones IN
    SELECT z.zone_name, z.prefix, COALESCE(z.max_capacity, 200) AS cap
    FROM zone_config z
    WHERE z.zone_name IN ('Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone')
  LOOP
    v_zone_name := v_zones.zone_name;
    v_prefix := v_zones.prefix;
    v_cap := v_zones.cap;
    v_prefix := CASE v_prefix WHEN 'F&B' THEN 'FB' ELSE v_prefix END;

    SELECT COUNT(*) INTO v_total FROM pallets WHERE current_zone = v_zone_name;
    v_occupancy := v_total;
    v_seq := v_total;

    SELECT COUNT(DISTINCT sku) INTO v_count
    FROM skus
    WHERE home_zone = v_zone_name AND is_active = true;
    IF v_count = 0 THEN CONTINUE; END IF;

    v_pallets_per_sku := GREATEST(1, (v_cap - v_occupancy) / v_count);

    FOR v_skus IN
      SELECT sku FROM skus WHERE home_zone = v_zone_name AND is_active = true
    LOOP
      FOR v_n IN 1..v_pallets_per_sku LOOP
        IF v_occupancy >= v_cap THEN EXIT; END IF;

        v_seq := v_seq + 1;
        v_serial := 'PRT-SIM-' || v_prefix || '-' || LPAD(v_seq::text, 5, '0');
        WHILE EXISTS (SELECT 1 FROM tickets WHERE serial = v_serial) LOOP
          v_seq := v_seq + 1;
          v_serial := 'PRT-SIM-' || v_prefix || '-' || LPAD(v_seq::text, 5, '0');
        END LOOP;

        INSERT INTO tickets (serial, date, sku, qty, uom)
        VALUES (v_serial, v_mfg, v_skus.sku, 100, 'KAR');

        -- Insert pallets explicitly while the create-pallet trigger is dropped
        INSERT INTO pallets (pallet_id, original_ticket_serial, pallet_type, current_zone, sku, quantity, remaining_quantity, status, zone_prefix)
        VALUES (v_serial, v_serial, 'Banded', v_zone_name, v_skus.sku, 100, 100, 'Active', v_zones.prefix);

        v_occupancy := v_occupancy + 1;
      END LOOP;
    END LOOP;

    UPDATE zone_config
    SET current_occupancy = (SELECT COUNT(*) FROM pallets WHERE current_zone = v_zone_name)
    WHERE zone_name = v_zone_name;
  END LOOP;

  -- SuperMarket (SM): derived from home-zone pallets (~1/3 per SKU, capped by SM capacity)
  FOR v_skus IN
    SELECT s.sku, s.home_zone
    FROM skus s
    WHERE s.home_zone IS NOT NULL AND s.is_active = true
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM pallets
    WHERE current_zone = v_skus.home_zone AND sku = v_skus.sku
      AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '');

    v_sm_count := FLOOR(v_count / 3.0)::int;
    IF v_sm_count <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(max_capacity, 450) INTO v_sm_cap
    FROM zone_config WHERE zone_name = 'SuperMarket Area';
    SELECT COUNT(*) INTO v_sm_occupancy FROM pallets WHERE current_zone = 'SuperMarket Area';

    v_sm_count := LEAST(v_sm_count, v_sm_cap - v_sm_occupancy);
    IF v_sm_count <= 0 THEN CONTINUE; END IF;

    FOR v_n IN 1..v_sm_count LOOP
      v_serial := 'PRT-SIM-SM-' || LPAD(floor(random() * 99999)::text, 5, '0');
      WHILE EXISTS (SELECT 1 FROM tickets WHERE serial = v_serial) LOOP
        v_serial := 'PRT-SIM-SM-' || LPAD(floor(random() * 99999)::text, 5, '0');
      END LOOP;

      INSERT INTO tickets (serial, date, sku, qty, uom)
      VALUES (v_serial, v_mfg, v_skus.sku, 100, 'KAR');

      INSERT INTO pallets (pallet_id, original_ticket_serial, pallet_type, current_zone, sku, quantity, remaining_quantity, status, zone_prefix)
      VALUES (v_serial, v_serial, 'Banded', 'SuperMarket Area', v_skus.sku, 100, 100, 'Active', 'SM');
    END LOOP;
  END LOOP;

  UPDATE zone_config
  SET current_occupancy = (SELECT COUNT(*) FROM pallets WHERE current_zone = 'SuperMarket Area')
  WHERE zone_name = 'SuperMarket Area';
END $$;

CREATE TRIGGER trg_create_pallet_from_ticket
  AFTER INSERT ON tickets FOR EACH ROW
  EXECUTE FUNCTION create_pallet_from_ticket();

-- Populate baseline stocks for replenishment thresholds
INSERT INTO zone_stock_baseline (zone, sku, baseline_pallets, baseline_qty, updated_at)
SELECT
  current_zone,
  sku,
  COUNT(*),
  COALESCE(SUM(remaining_quantity), 0),
  now()
FROM pallets
WHERE current_zone IN ('Detergents Zone','Fats Zone','Liquids/Oils Zone','Soaps Zone','Foods & Beverages Zone','SuperMarket Area')
  AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
GROUP BY current_zone, sku
ON CONFLICT (zone, sku) DO UPDATE SET
  baseline_pallets = EXCLUDED.baseline_pallets,
  baseline_qty = EXCLUDED.baseline_qty,
  updated_at = EXCLUDED.updated_at;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- E) Forklift + recent movement visual history (last 24h)
--    traffic-center.html renders FL icons from zone_movements.forklift_id via
--    `get_forklift_positions()`. Since reseed resets movements, we repopulate
--    a small synthetic history window so FLs reappear in the UI.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;
DELETE FROM zone_movements WHERE movement_id LIKE 'MOV-FL-RESEED-%';

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
  'MOV-FL-RESEED-' || gen_random_uuid()::text AS movement_id,
  p.pallet_id,
  p.current_zone AS from_zone,
  p.current_zone AS to_zone,
  dt::date AS movement_date,
  dt::time AS movement_time,
  'Reseed Simulation' AS moved_by,
  NULLIF('','') AS reason,
  NULLIF('','') AS override_reason,
  COALESCE(p.remaining_quantity, p.quantity, 0)::numeric AS quantity,
  NULL AS order_reference,
  NULL AS notes,
  dt AS created_at,
  'Received' AS movement_status,
  dt + (floor(random() * 180) + 60) * interval '1 second' AS received_at,
  'Reseed Simulation' AS received_by,
  f.id AS forklift_id
FROM (
  SELECT pallet_id, current_zone, remaining_quantity, quantity
  FROM pallets
  WHERE current_zone IS NOT NULL
    AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
  ORDER BY random()
  LIMIT 120
) p
CROSS JOIN LATERAL (SELECT now() - (random() * interval '24 hours') AS dt) t
LEFT JOIN LATERAL (SELECT id FROM forklifts ORDER BY random() LIMIT 1) f ON true;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- D) Stock report: SKU x Zone (effective zone)
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

-- Totals check
SELECT
  COALESCE(NULLIF(trim(in_transit_to_zone), ''), current_zone) AS effective_zone,
  COUNT(*) AS pallets,
  SUM(COALESCE(remaining_quantity, quantity, 0))::numeric AS total_qty_units
FROM pallets
WHERE sku IS NOT NULL
GROUP BY 1
ORDER BY effective_zone;

