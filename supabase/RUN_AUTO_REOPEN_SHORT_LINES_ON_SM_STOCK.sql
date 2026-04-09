-- RetiFlux™ — Auto-reopen SHORT lines when enough SuperMarket stock is available.
-- Goal:
--   Remove manual "↩ Undo" dependence for normal replenishment flow.
-- Behavior:
--   When a SKU has available stock in SuperMarket (not in transit),
--   reopen eligible order_lines (SHORT / PICKER_REPORTED_SHORT) in FIFO order
--   up to the available quantity for that SKU.

CREATE OR REPLACE FUNCTION auto_reopen_short_lines_for_sku(p_sku text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sku text := NULLIF(trim(p_sku), '');
  v_sm_available numeric := 0;
  v_reopened integer := 0;
BEGIN
  IF v_sku IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(COALESCE(p.remaining_quantity, p.quantity, 0)), 0)
    INTO v_sm_available
  FROM pallets p
  WHERE p.sku = v_sku
    AND p.current_zone = 'SuperMarket Area'
    AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
    AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0;

  IF v_sm_available <= 0 THEN
    RETURN 0;
  END IF;

  WITH candidates AS (
    SELECT
      ol.id,
      GREATEST(COALESCE(ol.quantity, 0) - COALESCE(ol.picked_quantity, 0), 0) AS needed,
      SUM(GREATEST(COALESCE(ol.quantity, 0) - COALESCE(ol.picked_quantity, 0), 0))
        OVER (ORDER BY ol.created_at, ol.id) AS running_needed
    FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
    WHERE ol.item_code = v_sku
      AND ol.status IN ('SHORT', 'PICKER_REPORTED_SHORT')
      AND GREATEST(COALESCE(ol.quantity, 0) - COALESCE(ol.picked_quantity, 0), 0) > 0
      AND COALESCE(o.status, '') NOT IN ('COMPLETED', 'CANCELLED')
  ),
  to_reopen AS (
    SELECT c.id
    FROM candidates c
    WHERE c.running_needed <= v_sm_available
  )
  UPDATE order_lines ol
     SET status = 'OPEN',
         updated_at = now()
   WHERE ol.id IN (SELECT id FROM to_reopen);

  GET DIAGNOSTICS v_reopened = ROW_COUNT;
  RETURN v_reopened;
END;
$$;

CREATE OR REPLACE FUNCTION trg_auto_reopen_short_lines_on_sm_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sku text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_zone = 'SuperMarket Area'
       AND (NEW.in_transit_to_zone IS NULL OR trim(NEW.in_transit_to_zone) = '')
       AND COALESCE(NEW.remaining_quantity, NEW.quantity, 0) > 0 THEN
      PERFORM auto_reopen_short_lines_for_sku(NEW.sku);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE path
  v_sku := COALESCE(NEW.sku, OLD.sku);
  IF v_sku IS NULL OR trim(v_sku) = '' THEN
    RETURN NEW;
  END IF;

  -- Re-check when this pallet becomes available in SuperMarket or qty changes there.
  IF (
       NEW.current_zone = 'SuperMarket Area'
       AND (NEW.in_transit_to_zone IS NULL OR trim(NEW.in_transit_to_zone) = '')
       AND COALESCE(NEW.remaining_quantity, NEW.quantity, 0) > 0
     ) AND (
       OLD.current_zone IS DISTINCT FROM NEW.current_zone
       OR OLD.in_transit_to_zone IS DISTINCT FROM NEW.in_transit_to_zone
       OR COALESCE(OLD.remaining_quantity, OLD.quantity, 0) IS DISTINCT FROM COALESCE(NEW.remaining_quantity, NEW.quantity, 0)
     ) THEN
    PERFORM auto_reopen_short_lines_for_sku(v_sku);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_reopen_short_lines_on_sm_stock ON pallets;
CREATE TRIGGER trg_auto_reopen_short_lines_on_sm_stock
AFTER INSERT OR UPDATE OF current_zone, in_transit_to_zone, remaining_quantity, quantity
ON pallets
FOR EACH ROW
EXECUTE PROCEDURE trg_auto_reopen_short_lines_on_sm_stock();

-- Optional: one-time backfill for SKUs already in SuperMarket.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT p.sku
    FROM pallets p
    WHERE p.current_zone = 'SuperMarket Area'
      AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
      AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
      AND p.sku IS NOT NULL
      AND trim(p.sku) <> ''
  LOOP
    PERFORM auto_reopen_short_lines_for_sku(r.sku);
  END LOOP;
END$$;

-- Quick checks:
-- SELECT auto_reopen_short_lines_for_sku('ELI-5L-4');
-- SELECT id, order_id, item_code, quantity, picked_quantity, status FROM order_lines WHERE item_code='ELI-5L-4' ORDER BY created_at;
