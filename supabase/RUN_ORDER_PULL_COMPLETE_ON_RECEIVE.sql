-- RetiFlux™ — Auto-complete ORDER_PICK / DT_MOVE replenishment tasks when the reserved pallet is *received*
-- into its destination zone. This dismisses ORDER_PULL_TASK notifications (see RUN_ORDER_PULL_ZONE_NOTIFICATIONS).
--
-- Why: The UI only sets replenishment_tasks.status = DONE when Initiate Move runs with pendingTaskId
-- (after "Execute" / "Open move form"). If a clerk moves the same pallet via Zone Monitor without that
-- link, or completion is only reflected at Receive, the task stayed PENDING and alerts never cleared.
--
-- Safe: Only updates rows still PENDING/IN_PROGRESS with matching reserved_pallet_id and to_zone = new location.
-- Run after: replenishment_tasks (reserved_pallet_id), pallets, movement_receive pattern in use.

CREATE OR REPLACE FUNCTION trg_pallets_complete_order_pull_on_receive()
RETURNS trigger AS $$
DECLARE
  v_dest text;
BEGIN
  -- Pallet just finished an inbound: was in transit, now landed in destination
  IF (NEW.in_transit_to_zone IS NULL OR trim(COALESCE(NEW.in_transit_to_zone, '')) = '')
     AND OLD.in_transit_to_zone IS NOT NULL
     AND trim(COALESCE(OLD.in_transit_to_zone, '')) <> ''
     AND trim(COALESCE(NEW.current_zone, '')) = trim(COALESCE(OLD.in_transit_to_zone, ''))
  THEN
    v_dest := trim(NEW.current_zone);
    UPDATE replenishment_tasks
    SET
      status = 'DONE',
      completed_at = COALESCE(NEW.last_moved_at, now()),
      completed_by = COALESCE(NULLIF(trim(NEW.last_moved_by), ''), 'system:receive'),
      updated_at = now()
    WHERE status IN ('PENDING', 'IN_PROGRESS')
      AND task_type IN ('ORDER_PICK', 'DT_MOVE')
      AND NULLIF(trim(reserved_pallet_id), '') IS NOT NULL
      AND trim(reserved_pallet_id) = trim(NEW.pallet_id)
      AND trim(to_zone) = v_dest;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pallets_complete_order_pull_on_receive ON pallets;
CREATE TRIGGER trg_pallets_complete_order_pull_on_receive
  AFTER UPDATE OF current_zone, in_transit_to_zone, last_moved_by, last_moved_at
  ON pallets
  FOR EACH ROW
  EXECUTE PROCEDURE trg_pallets_complete_order_pull_on_receive();

-- Optional one-time hygiene: dismiss stale ORDER_PULL notifs whose task is already DONE/CANCELLED
-- (e.g. moves completed before this trigger existed).
UPDATE zone_clerk_notifications z
SET read_at = now(), read_by = 'system:backfill'
WHERE z.kind = 'ORDER_PULL_TASK'
  AND z.read_at IS NULL
  AND NULLIF(trim(z.payload->>'task_id'), '') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM replenishment_tasks rt
    WHERE trim(rt.task_id) = trim(z.payload->>'task_id')
      AND rt.status IN ('DONE', 'CANCELLED')
  );
