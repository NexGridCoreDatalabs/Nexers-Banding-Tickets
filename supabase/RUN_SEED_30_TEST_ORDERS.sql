-- RetiFlux™ — Seed 30 deterministic test orders
-- external_order_no format: 5161#### (8 digits), e.g. 51610001 … 51610030 — same band as live-style refs like 51613699.
-- Safe to re-run: removes only those 30 numbers, then re-inserts.
--
-- Prerequisites (skip if you already did this once and skus still have home_zone):
--   • skus + home_zone — RUN_SKU_TABLE.sql then RUN_HOME_ZONE_AND_FB_ZONE.sql
--   • Optional: pallets — RUN_SIMULATION_FILL.sql so check_order_availability can allocate
--
-- Order header order_type ('DT' / 'MT') is for labeling; allocation still uses quantity-based DT_MOVE vs ORDER_PICK→SM.

DELETE FROM order_lines WHERE order_id IN (
  SELECT id FROM orders
  WHERE external_order_no >= '51610001' AND external_order_no <= '51610030'
);
DELETE FROM orders
WHERE external_order_no >= '51610001' AND external_order_no <= '51610030';

DO $$
DECLARE
  i int;
  v_order_id uuid;
  v_ext text;
  v_ot text;
  v_lines int;
  v_ln int;
  v_sku text;
  v_qty numeric;
  v_desc text;
  v_uom text;
  v_plant text;
  v_customers text[] := ARRAY[
    'Nairobi Wholesale Hub', 'Mombasa Fresh Mart', 'Kisumu Depot Ltd', 'Eldoret Retail Co',
    'Nakuru Distribution', 'Thika Grocers Union', 'Meru Trading House', 'Nyeri Stores PLC',
    'Embu Logistics', 'Machakos Outlet Group', 'Kitale Bulk Buyers', 'Kakamega Market Link',
    'Kericho Tea Traders', 'Naivasha Lake Foods', 'Bungoma Agro Supply'
  ];
  v_trans text[] := ARRAY['Bidco Fleet', 'KBS Logistics', 'Safari Express', 'Transami', 'MOW Cargo'];
  v_pickers jsonb;
  v_pi int := 0;
  v_puid text;
  v_pname text;
  -- SKUs spanning detergents, oils, fats, soaps, beverages (all have home_zone after RUN_HOME_ZONE)
  v_pool text[] := ARRAY[
    'MSAFI-LAV-500-12', 'ELI-2L-12', 'KIMBO-1KG-12', 'WSTAR-400G-24', 'PLANET-500ML-24',
    'NURU-1L-12', 'GFRY-1L-12', 'GENTAL-1KG-12', 'NOODIES-70G-48', 'MARI-100G-48'
  ];
  -- Quantity patterns (cap <= 2500 so no line needs > 2500 units).
  v_qtys numeric[] := ARRAY[36::numeric, 48, 72, 120, 480, 960, 1200, 1800, 2400];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM skus WHERE is_active = true AND home_zone IS NOT NULL LIMIT 1) THEN
    RAISE EXCEPTION 'No active SKUs with home_zone. Run RUN_SKU_TABLE.sql and RUN_HOME_ZONE_AND_FB_ZONE.sql first.';
  END IF;

  IF to_regclass('public.authorized_users') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', name) ORDER BY name), '[]'::jsonb)
    INTO v_pickers
    FROM authorized_users WHERE role = 'Picker';
  ELSE
    v_pickers := '[]'::jsonb;
  END IF;

  FOR i IN 1..30 LOOP
    v_ext := '5161' || LPAD(i::text, 4, '0');
    v_ot := CASE WHEN i % 2 = 1 THEN 'DT' ELSE 'MT' END;

    v_puid := NULL;
    v_pname := NULL;
    IF v_pickers IS NOT NULL AND jsonb_array_length(v_pickers) > 0 THEN
      v_puid := v_pickers->(v_pi % jsonb_array_length(v_pickers))->>'user_id';
      v_pname := v_pickers->(v_pi % jsonb_array_length(v_pickers))->>'name';
      v_pi := v_pi + 1;
    END IF;

    INSERT INTO orders (
      external_order_no, order_type, status, customer_name, customer_code, customer_no,
      order_date, delivery_date, transporter, total_lines, total_units,
      assigned_picker_user_id, assigned_picker_name,
      created_at, updated_at
    ) VALUES (
      v_ext,
      v_ot,
      'AWAITING_RELEASE',
      v_customers[1 + ((i - 1) % array_length(v_customers, 1))],
      'TST-' || LPAD(((i - 1) % 200 + 1)::text, 4, '0'),
      'CN-' || LPAD(i::text, 5, '0'),
      current_date - ((i % 7) + 1),
      current_date + ((i % 14) + 1),
      v_trans[1 + ((i - 1) % array_length(v_trans, 1))],
      0,
      0,
      v_puid,
      v_pname,
      now() - (i::text || ' hours')::interval,
      now() - (i::text || ' hours')::interval
    )
    RETURNING id INTO v_order_id;

    -- Line count: always at least 5 lines (some orders get up to 7 lines).
    -- This gives enough spread to trigger both SM_PICK and DT_MOVE paths.
    v_lines := 5 + ((i * 3 + 5) % 3);

    FOR v_ln IN 1..v_lines LOOP
      v_sku := v_pool[1 + ((i + v_ln * 7) % array_length(v_pool, 1))];
      -- Guarantee mixed allocation behavior per order:
      --  • line 1: large qty (DT_MOVE-friendly)
      --  • line 2: small qty (SM_PICK-friendly)
      --  • line 3: medium/large
      --  • remaining lines: deterministic mix
      IF v_ln = 1 THEN
        v_qty := CASE (i % 3)
          WHEN 0 THEN 2400
          WHEN 1 THEN 1800
          ELSE 1200
        END;
      ELSIF v_ln = 2 THEN
        v_qty := CASE (i % 3)
          WHEN 0 THEN 48
          WHEN 1 THEN 72
          ELSE 120
        END;
      ELSIF v_ln = 3 THEN
        v_qty := CASE (i % 4)
          WHEN 0 THEN 480
          WHEN 1 THEN 960
          WHEN 2 THEN 2400
          ELSE 1800
        END;
      ELSE
        v_qty := v_qtys[1 + ((i * v_ln + v_ln + i) % array_length(v_qtys, 1))];
      END IF;

      SELECT product_name, uom, subdivision
      INTO v_desc, v_uom, v_plant
      FROM skus WHERE sku = v_sku AND is_active = true
      LIMIT 1;

      IF v_desc IS NULL THEN
        v_sku := (SELECT sku FROM skus WHERE is_active = true AND home_zone IS NOT NULL ORDER BY sku LIMIT 1);
        SELECT product_name, uom, subdivision INTO v_desc, v_uom, v_plant FROM skus WHERE sku = v_sku;
        v_qty := 120;
      END IF;

      INSERT INTO order_lines (order_id, line_no, item_code, item_description, quantity, unit, plant, status)
      VALUES (v_order_id, v_ln, v_sku, v_desc, v_qty, COALESCE(v_uom, 'KAR'), COALESCE(v_plant, ''), 'OPEN');
    END LOOP;

    UPDATE orders
    SET
      total_lines = v_lines,
      total_units = (SELECT COALESCE(SUM(quantity), 0) FROM order_lines WHERE order_id = v_order_id)
    WHERE id = v_order_id;
  END LOOP;

  RAISE NOTICE 'Seeded 30 orders: 51610001 … 51610030';
END $$;

-- Quick verify
-- SELECT external_order_no, order_type, status, total_lines, total_units, customer_name
-- FROM orders WHERE external_order_no BETWEEN '51610001' AND '51610030' ORDER BY external_order_no;
