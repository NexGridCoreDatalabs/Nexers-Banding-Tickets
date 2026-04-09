-- RetiFlux™ — Auto-apply DT_MOVE fulfillment when pallet is received in Dispatch Loading Area
-- Purpose:
--   1) Mark matching DT_MOVE replenishment task(s) as DONE on receive
--   2) Increment order_lines.picked_quantity for the linked order_line_id
--   3) Auto-mark line PICKED when picked_quantity reaches quantity
--
-- Run after:
--   - replenishment_tasks has reserved_pallet_id + order_line_id (migration 019)
--   - pallets movement flow updates in_transit_to_zone/current_zone on receive

CREATE OR REPLACE FUNCTION trg_pallets_apply_dt_move_on_dispatch_receive()
RETURNS trigger AS $$
DECLARE
  v_completed_by text;
BEGIN
  -- Trigger only when pallet just finished transit and landed in its destination.
  IF (NEW.in_transit_to_zone IS NULL OR trim(COALESCE(NEW.in_transit_to_zone, '')) = '')
     AND OLD.in_transit_to_zone IS NOT NULL
     AND trim(COALESCE(OLD.in_transit_to_zone, '')) <> ''
     AND trim(COALESCE(NEW.current_zone, '')) = trim(COALESCE(OLD.in_transit_to_zone, ''))
     AND trim(COALESCE(NEW.current_zone, '')) = 'Dispatch Loading Area'
  THEN
    v_completed_by := COALESCE(NULLIF(trim(NEW.last_moved_by), ''), 'system:dispatch-receive');

    WITH done_tasks AS (
      UPDATE replenishment_tasks rt
      SET
        status = 'DONE',
        completed_at = COALESCE(NEW.last_moved_at, now()),
        completed_by = v_completed_by,
        updated_at = now()
      WHERE rt.status IN ('PENDING', 'IN_PROGRESS')
        AND rt.task_type = 'DT_MOVE'
        AND NULLIF(trim(rt.reserved_pallet_id), '') IS NOT NULL
        AND trim(rt.reserved_pallet_id) = trim(NEW.pallet_id)
        AND trim(COALESCE(rt.to_zone, '')) = 'Dispatch Loading Area'
      RETURNING rt.order_line_id, COALESCE(rt.quantity_needed, 0)::numeric AS qty_done
    ),
    line_rollup AS (
      SELECT order_line_id, SUM(qty_done)::numeric AS qty_done
      FROM done_tasks
      WHERE order_line_id IS NOT NULL
      GROUP BY order_line_id
    )
    UPDATE order_lines ol
    SET
      picked_quantity = LEAST(COALESCE(ol.quantity, 0), COALESCE(ol.picked_quantity, 0) + lr.qty_done),
      status = CASE
        WHEN LEAST(COALESCE(ol.quantity, 0), COALESCE(ol.picked_quantity, 0) + lr.qty_done) >= COALESCE(ol.quantity, 0)
          THEN 'PICKED'
        ELSE ol.status
      END
    FROM line_rollup lr
    WHERE ol.id = lr.order_line_id;

    -- Keep order counters aligned.
    UPDATE orders o
    SET
      picked_lines_count = (
        SELECT COUNT(*)
        FROM order_lines ol
        WHERE ol.order_id = o.id
          AND ol.status = 'PICKED'
      ),
      short_lines_count = (
        SELECT COUNT(*)
        FROM order_lines ol
        WHERE ol.order_id = o.id
          AND ol.status = 'SHORT'
      )
    WHERE o.id IN (
      SELECT DISTINCT ol.order_id
      FROM order_lines ol
      JOIN replenishment_tasks rt
        ON rt.order_line_id = ol.id
      WHERE rt.task_type = 'DT_MOVE'
        AND trim(COALESCE(rt.reserved_pallet_id, '')) = trim(NEW.pallet_id)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pallets_apply_dt_move_on_dispatch_receive ON pallets;
CREATE TRIGGER trg_pallets_apply_dt_move_on_dispatch_receive
AFTER UPDATE OF current_zone, in_transit_to_zone, last_moved_by, last_moved_at
ON pallets
FOR EACH ROW
EXECUTE PROCEDURE trg_pallets_apply_dt_move_on_dispatch_receive();

-- Optional one-time backfill for already-received DT pallets whose tasks still sit open.
-- (Safe to rerun; it only touches PENDING/IN_PROGRESS DT_MOVE tasks.)
WITH pending_dt AS (
  SELECT rt.task_id, rt.order_line_id, rt.quantity_needed
  FROM replenishment_tasks rt
  JOIN pallets p ON p.pallet_id = rt.reserved_pallet_id
  WHERE rt.task_type = 'DT_MOVE'
    AND rt.status IN ('PENDING', 'IN_PROGRESS')
    AND p.current_zone = 'Dispatch Loading Area'
    AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
),
done_now AS (
  UPDATE replenishment_tasks rt
  SET status = 'DONE', completed_at = now(), completed_by = 'system:backfill-dt', updated_at = now()
  WHERE rt.task_id IN (SELECT task_id FROM pending_dt)
  RETURNING rt.order_line_id, COALESCE(rt.quantity_needed, 0)::numeric AS qty_done
),
line_rollup AS (
  SELECT order_line_id, SUM(qty_done)::numeric AS qty_done
  FROM done_now
  WHERE order_line_id IS NOT NULL
  GROUP BY order_line_id
)
UPDATE order_lines ol
SET
  picked_quantity = LEAST(COALESCE(ol.quantity, 0), COALESCE(ol.picked_quantity, 0) + lr.qty_done),
  status = CASE
    WHEN LEAST(COALESCE(ol.quantity, 0), COALESCE(ol.picked_quantity, 0) + lr.qty_done) >= COALESCE(ol.quantity, 0)
      THEN 'PICKED'
    ELSE ol.status
  END
FROM line_rollup lr
WHERE ol.id = lr.order_line_id;

