-- RetiFlux™ — Stress seed: 7,000–7,500 pallets into Receiving Area (no movements)
-- Uses real serial format via get_next_prt_serial() and ticket -> pallet trigger.
--
-- Preconditions:
--   1) Transactional reset already run.
--   2) Function get_next_prt_serial() exists.
--   3) Trigger trg_create_pallet_from_ticket exists on tickets.
--
-- Notes:
--   - This script inserts into tickets only.
--   - Pallets are auto-created by create_pallet_from_ticket() in Receiving Area.
--   - No movement records are created.

DO $$
DECLARE
  v_min_pallets int := 7000;
  v_max_pallets int := 7500;
  v_target int;
  v_i int;

  -- Subdivision weights based on your SKU profile
  -- (higher weight => more pallets assigned)
  v_oils_w numeric := 0.40;
  v_det_w numeric := 0.24;
  v_soaps_w numeric := 0.20;
  v_bev_w numeric := 0.10;
  v_food_w numeric := 0.06;

  v_pick numeric;
  v_sku text;
  v_uom text;
  v_shelf int;
  v_serial text;
  v_qty numeric;
  v_mfg date;
  v_exp date;
  v_batch text;

  v_has_prt_fn boolean;
  v_has_ticket_trigger boolean;
BEGIN
  IF v_min_pallets <= 0 OR v_max_pallets < v_min_pallets THEN
    RAISE EXCEPTION 'Invalid target range: min %, max %', v_min_pallets, v_max_pallets;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_next_prt_serial'
  ) INTO v_has_prt_fn;

  IF NOT v_has_prt_fn THEN
    RAISE EXCEPTION 'Missing function public.get_next_prt_serial(). Run RUN_PRT_MIGRATION.sql first.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'tickets'
      AND t.tgname = 'trg_create_pallet_from_ticket'
      AND NOT t.tgisinternal
  ) INTO v_has_ticket_trigger;

  IF NOT v_has_ticket_trigger THEN
    RAISE EXCEPTION 'Missing trigger trg_create_pallet_from_ticket on public.tickets. Run RUN_CREATE_PALLET_FROM_TICKET.sql first.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM skus WHERE is_active = true) THEN
    RAISE EXCEPTION 'No active SKUs in public.skus';
  END IF;

  v_target := floor(random() * (v_max_pallets - v_min_pallets + 1) + v_min_pallets)::int;
  RAISE NOTICE 'Seeding target pallets: %', v_target;

  FOR v_i IN 1..v_target LOOP
    v_pick := random();

    -- Weighted subdivision pick
    IF v_pick < v_oils_w THEN
      SELECT sku, uom, shelf_life_days INTO v_sku, v_uom, v_shelf
      FROM skus
      WHERE is_active = true AND subdivision = 'Oils & Fats'
      ORDER BY random()
      LIMIT 1;
    ELSIF v_pick < (v_oils_w + v_soaps_w) THEN
      SELECT sku, uom, shelf_life_days INTO v_sku, v_uom, v_shelf
      FROM skus
      WHERE is_active = true AND subdivision = 'Soaps & Hygiene'
      ORDER BY random()
      LIMIT 1;
    ELSIF v_pick < (v_oils_w + v_soaps_w + v_det_w) THEN
      SELECT sku, uom, shelf_life_days INTO v_sku, v_uom, v_shelf
      FROM skus
      WHERE is_active = true AND subdivision = 'Detergents'
      ORDER BY random()
      LIMIT 1;
    ELSIF v_pick < (v_oils_w + v_soaps_w + v_det_w + v_bev_w) THEN
      SELECT sku, uom, shelf_life_days INTO v_sku, v_uom, v_shelf
      FROM skus
      WHERE is_active = true AND subdivision = 'Beverages'
      ORDER BY random()
      LIMIT 1;
    ELSE
      SELECT sku, uom, shelf_life_days INTO v_sku, v_uom, v_shelf
      FROM skus
      WHERE is_active = true AND subdivision = 'Foods'
      ORDER BY random()
      LIMIT 1;
    END IF;

    -- Fallback if subdivision bucket is empty
    IF v_sku IS NULL THEN
      SELECT sku, uom, shelf_life_days INTO v_sku, v_uom, v_shelf
      FROM skus
      WHERE is_active = true
      ORDER BY random()
      LIMIT 1;
    END IF;

    -- Real serial pattern used by your system
    SELECT get_next_prt_serial() INTO v_serial;

    -- Keep quantity in a stable stress-test band
    v_qty := (80 + floor(random() * 61))::numeric; -- 80..140
    v_mfg := current_date - (floor(random() * 30)::int);
    v_exp := CASE
      WHEN v_shelf IS NULL OR v_shelf <= 0 THEN NULL
      ELSE v_mfg + (v_shelf || ' days')::interval
    END::date;
    v_batch := 'STRESS-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_i::text, 6, '0');

    INSERT INTO tickets (
      serial, date, sku, qty, uom, batch_lot, expiry_date, notes
    ) VALUES (
      v_serial, v_mfg, v_sku, v_qty, COALESCE(v_uom, 'KAR'), v_batch, v_exp, 'STRESS-SEED: Receiving stock load'
    );
  END LOOP;

  -- Sync occupancy for Receiving Area after auto-created pallets
  UPDATE zone_config z
  SET current_occupancy = (
    SELECT COUNT(*) FROM pallets p WHERE p.current_zone = z.zone_name
  )
  WHERE z.zone_name = 'Receiving Area';

  RAISE NOTICE 'Stress seed completed.';
END $$;

-- Post-check 1: target state
SELECT
  COUNT(*)::bigint AS receiving_pallets,
  COALESCE(SUM(remaining_quantity), 0) AS receiving_qty
FROM pallets
WHERE current_zone = 'Receiving Area'
  AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '');

-- Post-check 2: subdivision distribution (from actual seeded pallets)
SELECT
  s.subdivision,
  COUNT(*)::bigint AS pallets,
  COALESCE(SUM(p.remaining_quantity), 0) AS qty
FROM pallets p
JOIN skus s ON s.sku = p.sku
WHERE p.current_zone = 'Receiving Area'
  AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
GROUP BY s.subdivision
ORDER BY pallets DESC, s.subdivision;

