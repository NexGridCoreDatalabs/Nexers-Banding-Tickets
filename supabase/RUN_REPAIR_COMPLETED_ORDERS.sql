-- RetiFlux™ — Repair: reopen orders that were incorrectly marked COMPLETED
-- What it does:
--   - Finds orders where status='COMPLETED' but the integrity rules do not pass:
--       * OPEN lines exist
--       * PICKER_REPORTED_SHORT lines exist
--       * pending ORDER_LINE replenishment tasks exist
--       * quantity/status mismatch exists (underpicked PICKED, non-underpicked SHORT)
--   - Sets orders.status back to 'IN_PROGRESS' so workflow can be completed correctly.
--
-- This is a "safe unblock" repair: it does NOT modify order_lines or replenishment_tasks.
-- It only reopens the order header.
--
-- Usage:
--   1) Run RUN_ORDER_COMPLETE_GUARD.sql (install trigger/guard)
--   2) Then run this file.

BEGIN;

-- 1) Dry-run list (review offenders)
WITH offenders AS (
  SELECT o.id
  FROM orders o
  WHERE o.status = 'COMPLETED'
    AND (
      EXISTS (
        SELECT 1 FROM order_lines ol
        WHERE ol.order_id = o.id
          AND ol.status IN ('OPEN', 'PICKER_REPORTED_SHORT')
      )
      OR EXISTS (
        SELECT 1 FROM replenishment_tasks rt
        WHERE rt.order_id = o.id
          AND rt.status IN ('PENDING','IN_PROGRESS')
          AND rt.trigger_reason = 'ORDER_LINE'
      )
      OR EXISTS (
        SELECT 1 FROM order_lines ol
        WHERE ol.order_id = o.id
          AND ol.status = 'PICKED'
          AND COALESCE(ol.picked_quantity,0) < COALESCE(ol.quantity,0)
      )
      OR EXISTS (
        SELECT 1 FROM order_lines ol
        WHERE ol.order_id = o.id
          AND ol.status = 'SHORT'
          AND COALESCE(ol.picked_quantity,0) >= COALESCE(ol.quantity,0)
      )
    )
)
SELECT
  id
FROM offenders
ORDER BY id
LIMIT 200;

-- 2) Actual repair update
WITH offenders AS (
  SELECT o.id
  FROM orders o
  WHERE o.status = 'COMPLETED'
    AND (
      EXISTS (
        SELECT 1 FROM order_lines ol
        WHERE ol.order_id = o.id
          AND ol.status IN ('OPEN', 'PICKER_REPORTED_SHORT')
      )
      OR EXISTS (
        SELECT 1 FROM replenishment_tasks rt
        WHERE rt.order_id = o.id
          AND rt.status IN ('PENDING','IN_PROGRESS')
          AND rt.trigger_reason = 'ORDER_LINE'
      )
      OR EXISTS (
        SELECT 1 FROM order_lines ol
        WHERE ol.order_id = o.id
          AND ol.status = 'PICKED'
          AND COALESCE(ol.picked_quantity,0) < COALESCE(ol.quantity,0)
      )
      OR EXISTS (
        SELECT 1 FROM order_lines ol
        WHERE ol.order_id = o.id
          AND ol.status = 'SHORT'
          AND COALESCE(ol.picked_quantity,0) >= COALESCE(ol.quantity,0)
      )
    )
)
UPDATE orders o
SET status = 'IN_PROGRESS',
    updated_at = now()
WHERE o.id IN (SELECT id FROM offenders);

COMMIT;

