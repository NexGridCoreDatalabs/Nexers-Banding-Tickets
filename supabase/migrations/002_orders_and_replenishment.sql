-- RetiFlux™ — Orders + Picking Replenishment
-- Migration 002: Orders ingestion (OCR), order lines, replenishment tasks

-- ─────────────────────────────────────────────────────────────────────────────
-- ORDERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_order_no text,
  order_type text NOT NULL CHECK (order_type IN ('DT', 'MT')),
  status text NOT NULL DEFAULT 'AWAITING_OCR',
  assigned_picker_user_id text,
  assigned_picker_name text,
  customer_name text,
  customer_code text,
  customer_no text,
  order_date date,
  delivery_date date,
  transporter text,
  pages_total integer,
  total_lines integer NOT NULL DEFAULT 0,
  total_units numeric(14,2) NOT NULL DEFAULT 0,
  scan_storage_bucket text,
  scan_storage_path text,
  scan_original_filename text,
  ocr_raw_text text,
  ocr_confidence numeric(6,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_external_order_no_idx ON orders(external_order_no);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_assigned_picker_user_id_idx ON orders(assigned_picker_user_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- ORDER LINES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_code text NOT NULL,
  item_description text,
  quantity numeric(14,2) NOT NULL DEFAULT 0,
  unit text,
  plant text,
  picked_quantity numeric(14,2) NOT NULL DEFAULT 0,
  short_quantity numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, line_no)
);

CREATE INDEX IF NOT EXISTS order_lines_order_id_idx ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS order_lines_item_code_idx ON order_lines(item_code);
CREATE INDEX IF NOT EXISTS order_lines_status_idx ON order_lines(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- REPLENISHMENT TASKS (for zone clerks)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replenishment_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_id uuid REFERENCES order_lines(id) ON DELETE SET NULL,
  sku text NOT NULL,
  quantity_needed numeric(14,2) NOT NULL DEFAULT 0,
  from_zone text NOT NULL,
  to_zone text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by text,
  notes text
);

CREATE INDEX IF NOT EXISTS replenishment_tasks_order_id_idx ON replenishment_tasks(order_id);
CREATE INDEX IF NOT EXISTS replenishment_tasks_from_zone_idx ON replenishment_tasks(from_zone);
CREATE INDEX IF NOT EXISTS replenishment_tasks_status_idx ON replenishment_tasks(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS POLICIES (match existing app pattern: anon read/write; tighten later)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE replenishment_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_anon_select" ON orders;
CREATE POLICY "orders_anon_select" ON orders FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "orders_anon_insert" ON orders;
CREATE POLICY "orders_anon_insert" ON orders FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "orders_anon_update" ON orders;
CREATE POLICY "orders_anon_update" ON orders FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "order_lines_anon_select" ON order_lines;
CREATE POLICY "order_lines_anon_select" ON order_lines FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "order_lines_anon_insert" ON order_lines;
CREATE POLICY "order_lines_anon_insert" ON order_lines FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "order_lines_anon_update" ON order_lines;
CREATE POLICY "order_lines_anon_update" ON order_lines FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "replenishment_tasks_anon_select" ON replenishment_tasks;
CREATE POLICY "replenishment_tasks_anon_select" ON replenishment_tasks FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "replenishment_tasks_anon_insert" ON replenishment_tasks;
CREATE POLICY "replenishment_tasks_anon_insert" ON replenishment_tasks FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "replenishment_tasks_anon_update" ON replenishment_tasks;
CREATE POLICY "replenishment_tasks_anon_update" ON replenishment_tasks FOR UPDATE TO anon USING (true) WITH CHECK (true);

