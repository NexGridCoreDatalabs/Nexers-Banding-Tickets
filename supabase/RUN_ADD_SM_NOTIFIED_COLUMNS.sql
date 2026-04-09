-- RetiFlux™ — Persisted SM->Zone notifications
-- Adds columns so SM clerk notifications are visible on the respective product zone clerks UI.

ALTER TABLE replenishment_tasks
  ADD COLUMN IF NOT EXISTS sm_notified_at timestamptz;

ALTER TABLE replenishment_tasks
  ADD COLUMN IF NOT EXISTS sm_notified_by text;

CREATE INDEX IF NOT EXISTS replenishment_tasks_sm_notified_at_idx
  ON replenishment_tasks(sm_notified_at)
  WHERE sm_notified_at IS NOT NULL;

