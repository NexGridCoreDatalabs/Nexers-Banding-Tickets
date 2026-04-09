-- RetiFlux™ — Auto-dismiss FORKLIFT_AVAILABLE when that forklift is assigned again (available -> busy)
-- Run if you already applied RUN_ZONE_CLERK_NOTIFICATIONS.sql before this trigger existed.

CREATE OR REPLACE FUNCTION trg_forklifts_auto_dismiss_avail_notif()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'busy'
     AND COALESCE(OLD.status, '') = 'available' THEN
    UPDATE zone_clerk_notifications
    SET read_at = now(),
        read_by = 'system'
    WHERE kind = 'FORKLIFT_AVAILABLE'
      AND read_at IS NULL
      AND NULLIF(trim(payload->>'forklift_id'), '') IS NOT NULL
      AND (payload->>'forklift_id')::uuid = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_forklifts_auto_dismiss_avail_notif ON forklifts;
CREATE TRIGGER trg_forklifts_auto_dismiss_avail_notif
  AFTER UPDATE OF status ON forklifts
  FOR EACH ROW
  EXECUTE PROCEDURE trg_forklifts_auto_dismiss_avail_notif();
