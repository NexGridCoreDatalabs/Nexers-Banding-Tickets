-- RetiFlux™ — SM Release columns for orders
-- Run in Supabase SQL Editor
-- Picker submits → AWAITING_SM_RELEASE → SM clerk releases → COMPLETED

ALTER TABLE orders ADD COLUMN IF NOT EXISTS sm_released_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sm_released_by text;

CREATE INDEX IF NOT EXISTS orders_status_awaiting_release_idx ON orders(status) WHERE status = 'AWAITING_SM_RELEASE';