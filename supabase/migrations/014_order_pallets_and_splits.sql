-- RetiFlux™ — Order pallets, pallet contents, pallet splits
-- Migration 014: Child pallets linked to orders; trail for parent-sharing
-- Design: Picker creates order pallet in SM → picks line-by-line → splits from parent → completes pallet for zone clerk

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add next_order_pallet_number to zone_config (SuperMarket Area)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE zone_config ADD COLUMN IF NOT EXISTS next_order_pallet_number integer NOT NULL DEFAULT 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ORDER_PALLETS — links order to child pallets (one order can have multiple)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_pallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  pallet_id text NOT NULL REFERENCES pallets(pallet_id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'complete', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  completed_at timestamptz,
  completed_by text,
  UNIQUE(order_id, pallet_id)
);

CREATE INDEX IF NOT EXISTS order_pallets_order_id_idx ON order_pallets(order_id);
CREATE INDEX IF NOT EXISTS order_pallets_pallet_id_idx ON order_pallets(pallet_id);
CREATE INDEX IF NOT EXISTS order_pallets_status_idx ON order_pallets(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PALLET_CONTENTS — multi-SKU contents of order pallets
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pallet_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pallet_id text NOT NULL REFERENCES pallets(pallet_id) ON DELETE CASCADE,
  sku text NOT NULL,
  quantity numeric(14,2) NOT NULL DEFAULT 0,
  source_pallet_id text REFERENCES pallets(pallet_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pallet_contents_pallet_id_idx ON pallet_contents(pallet_id);
CREATE INDEX IF NOT EXISTS pallet_contents_sku_idx ON pallet_contents(sku);
CREATE UNIQUE INDEX IF NOT EXISTS pallet_contents_pallet_sku_idx ON pallet_contents(pallet_id, sku);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PALLET_SPLITS — trail: parent → child, which order, qty (for parent-sharing visibility)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pallet_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_pallet_id text NOT NULL REFERENCES pallets(pallet_id) ON DELETE CASCADE,
  child_pallet_id text NOT NULL REFERENCES pallets(pallet_id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_id uuid REFERENCES order_lines(id) ON DELETE SET NULL,
  sku text NOT NULL,
  quantity numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE INDEX IF NOT EXISTS pallet_splits_parent_idx ON pallet_splits(parent_pallet_id);
CREATE INDEX IF NOT EXISTS pallet_splits_child_idx ON pallet_splits(child_pallet_id);
CREATE INDEX IF NOT EXISTS pallet_splits_order_idx ON pallet_splits(order_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE order_pallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pallet_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pallet_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_pallets_anon_select" ON order_pallets;
CREATE POLICY "order_pallets_anon_select" ON order_pallets FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "order_pallets_anon_insert" ON order_pallets;
CREATE POLICY "order_pallets_anon_insert" ON order_pallets FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "order_pallets_anon_update" ON order_pallets;
CREATE POLICY "order_pallets_anon_update" ON order_pallets FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pallet_contents_anon_select" ON pallet_contents;
CREATE POLICY "pallet_contents_anon_select" ON pallet_contents FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "pallet_contents_anon_insert" ON pallet_contents;
CREATE POLICY "pallet_contents_anon_insert" ON pallet_contents FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "pallet_splits_anon_select" ON pallet_splits;
CREATE POLICY "pallet_splits_anon_select" ON pallet_splits FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "pallet_splits_anon_insert" ON pallet_splits;
CREATE POLICY "pallet_splits_anon_insert" ON pallet_splits FOR INSERT TO anon WITH CHECK (true);
