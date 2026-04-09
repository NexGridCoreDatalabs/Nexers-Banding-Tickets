-- RetiFlux™ — Replenishment integration + zone capacities
-- Migration 003: Zone capacities, replenishment_tasks extension, replenishment_warnings

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ensure Foods & Beverages Zone exists (from RUN_HOME_ZONE_AND_FB_ZONE)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO zone_config (zone_name, prefix, allows_splitting, fifo_required, shelf_life_days, default_status)
VALUES ('Foods & Beverages Zone', 'F&B', false, true, 365, 'Active')
ON CONFLICT (zone_name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Zone capacities (max_capacity)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE zone_config SET max_capacity = 50   WHERE zone_name = 'Receiving Area';
UPDATE zone_config SET max_capacity = 200  WHERE zone_name = 'Detergents Zone';
UPDATE zone_config SET max_capacity = 250  WHERE zone_name = 'Fats Zone';
UPDATE zone_config SET max_capacity = 300  WHERE zone_name = 'Liquids/Oils Zone';
UPDATE zone_config SET max_capacity = 150  WHERE zone_name = 'Soaps Zone';
UPDATE zone_config SET max_capacity = 200  WHERE zone_name = 'Foods & Beverages Zone';
UPDATE zone_config SET max_capacity = 450  WHERE zone_name = 'SuperMarket Area';
UPDATE zone_config SET max_capacity = 30   WHERE zone_name = 'QA Hold';
UPDATE zone_config SET max_capacity = 20   WHERE zone_name = 'Rework Zone';
UPDATE zone_config SET max_capacity = 80   WHERE zone_name = 'Dispatch Loading Area';
UPDATE zone_config SET max_capacity = 60   WHERE zone_name = 'Outbounding';
-- Outbonded: no cap (max_capacity stays NULL)

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Extend replenishment_tasks for integrated model
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE replenishment_tasks
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE replenishment_tasks
  ADD COLUMN IF NOT EXISTS task_type text DEFAULT 'ORDER_PICK'
    CHECK (task_type IN ('ORDER_PICK', 'SM_REPLENISH', 'ZONE_REPLENISH'));

ALTER TABLE replenishment_tasks
  ADD COLUMN IF NOT EXISTS trigger_reason text
    CHECK (trigger_reason IS NULL OR trigger_reason IN ('ORDER_LINE', 'SM_BELOW_10PCT', 'ZONE_BELOW_30PCT_WARN', 'ZONE_BELOW_10PCT'));

ALTER TABLE replenishment_tasks
  ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0;

-- Backfill existing rows
UPDATE replenishment_tasks SET task_type = 'ORDER_PICK', trigger_reason = 'ORDER_LINE' WHERE task_type IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. replenishment_warnings table (30% stock warnings)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replenishment_warnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone text NOT NULL,
  sku text NOT NULL,
  stock_pct numeric(8,4) NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  acknowledged_by text
);

CREATE INDEX IF NOT EXISTS replenishment_warnings_zone_idx ON replenishment_warnings(zone);
CREATE INDEX IF NOT EXISTS replenishment_warnings_sku_idx ON replenishment_warnings(sku);
CREATE INDEX IF NOT EXISTS replenishment_warnings_triggered_at_idx ON replenishment_warnings(triggered_at);

ALTER TABLE replenishment_warnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "replenishment_warnings_anon_select" ON replenishment_warnings;
CREATE POLICY "replenishment_warnings_anon_select" ON replenishment_warnings FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "replenishment_warnings_anon_insert" ON replenishment_warnings;
CREATE POLICY "replenishment_warnings_anon_insert" ON replenishment_warnings FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "replenishment_warnings_anon_update" ON replenishment_warnings;
CREATE POLICY "replenishment_warnings_anon_update" ON replenishment_warnings FOR UPDATE TO anon USING (true) WITH CHECK (true);
