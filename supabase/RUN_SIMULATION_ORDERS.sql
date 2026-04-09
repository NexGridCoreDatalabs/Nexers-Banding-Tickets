DELETE FROM order_lines WHERE order_id IN (SELECT id FROM orders WHERE external_order_no LIKE 'SO-SIM-%');
DELETE FROM orders WHERE external_order_no LIKE 'SO-SIM-%';

DO $$
DECLARE
  v_order_id uuid;
  v_ord_no int;
  v_lines int;
  v_ln int;
  v_sku text;
  v_qty numeric;
  v_skus text[];
  v_hot_skus text[];
  v_customers text[] := ARRAY['Eldoret Retail Ltd','Nakuru Wholesale','Kisumu Distributors','Mombasa Trading','Nairobi Central Store','Thika Fresh Supplies','Meru Grocers','Nyeri Depot','Embu Wholesale','Machakos Retail'];
  v_cand_hot text[] := ARRAY['ELI-2L-12','GFRY-1L-12','KIMBO-1KG-12','MSAFI-LAV-500-12'];
  v_transporters text[] := ARRAY['KBS Logistics','Safari Express','Transami','MOW','Bidco Fleet'];
  v_pickers jsonb;
  v_picker_idx int;
  v_i int;
  v_cust text;
  v_trans text;
  v_max int;
  v_desc text;
  v_uom text;
  v_plant text;
BEGIN
  v_max := 45 + (random() * 11)::int;
  SELECT array_agg(sku) INTO v_skus FROM skus WHERE is_active = true;
  IF v_skus IS NULL OR array_length(v_skus, 1) < 2 THEN
    RAISE NOTICE 'Need at least 2 SKUs in skus table';
    RETURN;
  END IF;

  SELECT array_agg(c) INTO v_hot_skus FROM unnest(v_cand_hot) c WHERE c = ANY(v_skus);
  IF v_hot_skus IS NULL OR array_length(v_hot_skus, 1) = 0 THEN
    v_hot_skus := v_skus[1:LEAST(4, array_length(v_skus,1))];
  END IF;

  SELECT jsonb_agg(jsonb_build_object('user_id', user_id, 'name', name) ORDER BY name)
  INTO v_pickers FROM authorized_users WHERE role = 'Picker';
  IF v_pickers IS NULL OR jsonb_array_length(v_pickers) = 0 THEN
    RAISE NOTICE 'No pickers in authorized_users (role=Picker). Orders will have no assigned picker.';
  END IF;

  v_picker_idx := 0;

  FOR v_ord_no IN 1..v_max LOOP
    v_cust := v_customers[1 + (v_ord_no - 1) % array_length(v_customers, 1)];
    v_trans := v_transporters[1 + (v_ord_no - 1) % array_length(v_transporters, 1)];

    INSERT INTO orders (
      external_order_no, order_type, status, customer_name, customer_code,
      order_date, delivery_date, transporter, total_lines, total_units,
      assigned_picker_user_id, assigned_picker_name,
      created_at, updated_at
    )
    SELECT
      'SO-SIM-' || LPAD(v_ord_no::text, 5, '0'),
      CASE WHEN random() < 0.5 THEN 'DT' ELSE 'MT' END,
      'AWAITING_RELEASE',
      v_cust,
      'CUST' || LPAD((v_ord_no % 10 + 1)::text, 3, '0'),
      current_date,
      current_date + 2,
      v_trans,
      0,
      0,
      CASE WHEN v_pickers IS NOT NULL AND jsonb_array_length(v_pickers) > 0
        THEN (v_pickers->(v_picker_idx % jsonb_array_length(v_pickers))->>'user_id')
        ELSE NULL END,
      CASE WHEN v_pickers IS NOT NULL AND jsonb_array_length(v_pickers) > 0
        THEN (v_pickers->(v_picker_idx % jsonb_array_length(v_pickers))->>'name')
        ELSE NULL END,
      (current_date + time '08:00' + (v_ord_no - 1)::numeric / GREATEST(1, v_max - 1) * interval '7 hours')::timestamptz,
      (current_date + time '08:00' + (v_ord_no - 1)::numeric / GREATEST(1, v_max - 1) * interval '7 hours')::timestamptz
    FROM (SELECT 1) _
    RETURNING id INTO v_order_id;

    IF v_pickers IS NOT NULL AND jsonb_array_length(v_pickers) > 0 THEN
      v_picker_idx := v_picker_idx + 1;
    END IF;

    v_lines := 2 + (random() * 4)::int;

    FOR v_ln IN 1..v_lines LOOP
      IF v_ord_no >= v_max - 8 AND v_ln <= 2 THEN
        v_sku := v_hot_skus[1 + (v_ord_no + v_ln - 1) % array_length(v_hot_skus, 1)];
        v_qty := 2500 + (random() * 1500)::int;
      ELSE
        v_i := 1 + (random() * (array_length(v_skus, 1) - 1))::int;
        v_sku := v_skus[v_i];
        v_qty := (10 + (random() * 90))::int;
      END IF;

      SELECT product_name, uom, subdivision INTO v_desc, v_uom, v_plant FROM skus WHERE sku = v_sku AND is_active = true LIMIT 1;

      INSERT INTO order_lines (order_id, line_no, item_code, item_description, quantity, unit, plant, status)
      VALUES (v_order_id, v_ln, v_sku, v_desc, v_qty, COALESCE(v_uom, 'KAR'), COALESCE(v_plant, ''), 'OPEN');
    END LOOP;

    UPDATE orders
    SET total_lines = v_lines,
        total_units = (SELECT COALESCE(SUM(quantity), 0) FROM order_lines WHERE order_id = v_order_id)
    WHERE id = v_order_id;
  END LOOP;
END $$;
