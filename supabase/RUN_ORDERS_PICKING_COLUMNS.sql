-- RetiFlux™ — Orders picking columns (for Order Detail & Picker Portal)
-- Run in Supabase SQL Editor after 002_orders_and_replenishment.sql
-- These columns are used by order-detail.html and pickers.html

ALTER TABLE orders ADD COLUMN IF NOT EXISTS picking_started_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picking_finished_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picking_duration_seconds integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_lines_count integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS short_lines_count integer NOT NULL DEFAULT 0;
