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

    SELECT COUNT(DISTINCT sku) INTO v_count FROM skus WHERE home_zone = v_zone_name AND is_active = true;
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

        INSERT INTO pallets (pallet_id, original_ticket_serial, pallet_type, current_zone, sku, quantity, remaining_quantity, status, zone_prefix)
        VALUES (v_serial, v_serial, 'Banded', v_zone_name, v_skus.sku, 100, 100, 'Active', v_zones.prefix);

        v_occupancy := v_occupancy + 1;
      END LOOP;
    END LOOP;

    UPDATE zone_config SET current_occupancy = (SELECT COUNT(*) FROM pallets WHERE current_zone = v_zone_name)
    WHERE zone_name = v_zone_name;
  END LOOP;

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

    SELECT COALESCE(max_capacity, 450) INTO v_sm_cap FROM zone_config WHERE zone_name = 'SuperMarket Area';
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

  UPDATE zone_config SET current_occupancy = (SELECT COUNT(*) FROM pallets WHERE current_zone = 'SuperMarket Area')
  WHERE zone_name = 'SuperMarket Area';
END $$;

CREATE TRIGGER trg_create_pallet_from_ticket
  AFTER INSERT ON tickets FOR EACH ROW
  EXECUTE FUNCTION create_pallet_from_ticket();

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
