-- RetiFlux™ — Notify zone clerks when order pull creates replenishment tasks; dismiss when task completes
-- Run after: zone_clerk_notifications, replenishment_tasks (with order_id + task_type ORDER_PICK / DT_MOVE).

CREATE OR REPLACE FUNCTION trg_replenishment_tasks_notify_order_pull()
RETURNS trigger AS $$
DECLARE
  v_ext text;
  v_title text;
  v_body text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.order_id IS NULL OR NEW.status IS DISTINCT FROM 'PENDING' THEN
    RETURN NEW;
  END IF;

  IF NEW.task_type IS NULL OR NEW.task_type NOT IN ('ORDER_PICK', 'DT_MOVE') THEN
    RETURN NEW;
  END IF;

  IF NEW.from_zone IS NULL OR trim(NEW.from_zone) = '' THEN
    RETURN NEW;
  END IF;

  SELECT o.external_order_no INTO v_ext FROM orders o WHERE o.id = NEW.order_id;
  v_ext := COALESCE(NULLIF(trim(v_ext), ''), NEW.order_id::text);

  v_title := CASE NEW.task_type
    WHEN 'DT_MOVE' THEN 'Move full pallet to Dispatch'
    ELSE 'Picker waiting for stock in SuperMarket'
  END;

  v_body :=
    'Order ' || v_ext || ': ' ||
    CASE NEW.task_type
      WHEN 'DT_MOVE' THEN
        'move a full pallet of SKU ' || COALESCE(NEW.sku, '—') ||
        ' from ' || NEW.from_zone || ' to Dispatch.'
      ELSE
        'picker needs SKU ' || COALESCE(NEW.sku, '—') ||
        ' moved from ' || NEW.from_zone || ' to ' || COALESCE(NEW.to_zone, 'SuperMarket Area') || '.'
    END ||
    ' Qty: ' || COALESCE(NEW.quantity_needed::text, '—') ||
    '. Suggested pallet: ' || COALESCE(NULLIF(trim(NEW.reserved_pallet_id), ''), 'FIFO / reserved') ||
    '. Task: ' || COALESCE(NEW.task_id, '—') || '.' ||
    CASE NEW.task_type
      WHEN 'DT_MOVE' THEN ' What to do now: Open move form and push this pallet to Dispatch.'
      ELSE ' What to do now: Open move form and send the next pallet to SuperMarket so picker can continue.'
    END;

  INSERT INTO zone_clerk_notifications (
    target_zone, kind, title, body, payload, created_by
  ) VALUES (
    NEW.from_zone,
    'ORDER_PULL_TASK',
    v_title,
    v_body,
    jsonb_build_object(
      'task_id', NEW.task_id,
      'order_id', NEW.order_id,
      'external_order_no', v_ext,
      'sku', NEW.sku,
      'from_zone', NEW.from_zone,
      'to_zone', NEW.to_zone,
      'task_type', NEW.task_type,
      'quantity_needed', NEW.quantity_needed
    ),
    'system'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_replenishment_tasks_notify_order_pull ON replenishment_tasks;
CREATE TRIGGER trg_replenishment_tasks_notify_order_pull
  AFTER INSERT ON replenishment_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE trg_replenishment_tasks_notify_order_pull();

-- When clerk completes (or cancels) the task, clear matching unread alert
CREATE OR REPLACE FUNCTION trg_replenishment_tasks_dismiss_order_pull_notif()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.task_id IS NOT NULL
     AND NEW.status IN ('DONE', 'CANCELLED')
     AND (OLD.status IS NULL OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE zone_clerk_notifications
    SET read_at = now(),
        read_by = 'system'
    WHERE kind = 'ORDER_PULL_TASK'
      AND read_at IS NULL
      AND NULLIF(trim(payload->>'task_id'), '') IS NOT NULL
      AND trim(payload->>'task_id') = trim(NEW.task_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_replenishment_tasks_dismiss_order_pull_notif ON replenishment_tasks;
CREATE TRIGGER trg_replenishment_tasks_dismiss_order_pull_notif
  AFTER UPDATE OF status ON replenishment_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE trg_replenishment_tasks_dismiss_order_pull_notif();

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL — existing open ORDER_PICK / DT_MOVE tasks (created before triggers)
-- Idempotent: skips if any ORDER_PULL_TASK already references the same task_id.
-- Safe to re-run after the triggers above.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO zone_clerk_notifications (
  target_zone, kind, title, body, payload, created_by
)
SELECT
  rt.from_zone,
  'ORDER_PULL_TASK',
  CASE rt.task_type
    WHEN 'DT_MOVE' THEN 'Move full pallet to Dispatch'
    ELSE 'Picker waiting for stock in SuperMarket'
  END,
  'Order ' || COALESCE(NULLIF(trim(o.external_order_no), ''), o.id::text) || ': '
    || CASE rt.task_type
         WHEN 'DT_MOVE' THEN
           'move a full pallet of SKU ' || COALESCE(rt.sku, '—') || ' from ' || rt.from_zone || ' to Dispatch.'
         ELSE
           'picker needs SKU ' || COALESCE(rt.sku, '—') || ' moved from ' || rt.from_zone || ' to ' || COALESCE(rt.to_zone, 'SuperMarket Area') || '.'
       END
    || ' Qty: ' || COALESCE(rt.quantity_needed::text, '—')
    || '. Suggested pallet: ' || COALESCE(NULLIF(trim(rt.reserved_pallet_id), ''), 'FIFO / reserved')
    || '. Task: ' || COALESCE(rt.task_id, '—') || '.'
    || CASE rt.task_type
         WHEN 'DT_MOVE' THEN ' What to do now: Open move form and push this pallet to Dispatch.'
         ELSE ' What to do now: Open move form and send the next pallet to SuperMarket so picker can continue.'
       END,
  jsonb_build_object(
    'task_id', rt.task_id,
    'order_id', rt.order_id,
    'external_order_no', COALESCE(NULLIF(trim(o.external_order_no), ''), o.id::text),
    'sku', rt.sku,
    'from_zone', rt.from_zone,
    'to_zone', rt.to_zone,
    'task_type', rt.task_type,
    'quantity_needed', rt.quantity_needed
  ),
  'system'
FROM replenishment_tasks rt
INNER JOIN orders o ON o.id = rt.order_id
WHERE rt.task_type IN ('ORDER_PICK', 'DT_MOVE')
  AND rt.order_id IS NOT NULL
  AND rt.status IN ('PENDING', 'IN_PROGRESS')
  AND rt.from_zone IS NOT NULL
  AND trim(rt.from_zone) <> ''
  AND rt.task_id IS NOT NULL
  AND trim(rt.task_id) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM zone_clerk_notifications z
    WHERE z.kind = 'ORDER_PULL_TASK'
      AND NULLIF(trim(z.payload->>'task_id'), '') IS NOT NULL
      AND trim(z.payload->>'task_id') = trim(rt.task_id)
  );

-- Optional checks:
-- SELECT COUNT(*) FROM zone_clerk_notifications WHERE kind = 'ORDER_PULL_TASK';
-- SELECT * FROM zone_clerk_notifications WHERE kind = 'ORDER_PULL_TASK' ORDER BY created_at DESC LIMIT 30;
--
-- If alerts stay up after the pallet really arrived: dismiss is tied to replenishment_tasks → DONE.
-- Also run: RUN_ORDER_PULL_COMPLETE_ON_RECEIVE.sql (auto-DONE on receive + backfill stale notifs).
