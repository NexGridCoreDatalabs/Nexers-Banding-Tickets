-- RetiFlux™ — Picking Halt fields
-- Stores why a picker halted the order, so order-detail can show it.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS picking_halted_at timestamptz,
  ADD COLUMN IF NOT EXISTS picking_halted_reason text,
  ADD COLUMN IF NOT EXISTS picking_halted_by text;

