-- RetiFlux™ — PostgreSQL Initial Schema
-- Migration 001: Tables, indexes, constraints
-- Run against Supabase (PostgreSQL 15+)

-- ─────────────────────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- ZONE CONFIG
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE zone_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_name text NOT NULL UNIQUE,
  prefix text NOT NULL,
  allows_splitting boolean NOT NULL DEFAULT false,
  fifo_required boolean NOT NULL DEFAULT false,
  shelf_life_days integer,
  max_capacity integer,
  current_occupancy integer NOT NULL DEFAULT 0,
  next_pallet_number integer NOT NULL DEFAULT 1,
  default_status text NOT NULL DEFAULT 'Active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zone_config_zone_name_idx ON zone_config(zone_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- ZONE TRANSITIONS (valid from→to pairs for routing enforcement)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE zone_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_zone text NOT NULL,
  to_zone text NOT NULL,
  UNIQUE(from_zone, to_zone)
);

CREATE INDEX zone_transitions_from_idx ON zone_transitions(from_zone);

-- ─────────────────────────────────────────────────────────────────────────────
-- SKU ZONE MAPPING
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sku_zone_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  allowed_zones text[] NOT NULL DEFAULT '{}',
  default_zone text,
  requires_banding boolean NOT NULL DEFAULT false,
  shelf_life_days integer,
  notes text,
  product_type text,
  sachet_type text,
  tablet_type text,
  uom text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sku_zone_mapping_sku_idx ON sku_zone_mapping(sku);

-- ─────────────────────────────────────────────────────────────────────────────
-- AUTHORIZED USERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE authorized_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,
  name text NOT NULL,
  passcode_hash text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX authorized_users_user_id_idx ON authorized_users(user_id);
CREATE INDEX authorized_users_role_idx ON authorized_users(role);

-- ─────────────────────────────────────────────────────────────────────────────
-- TICKETS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial text NOT NULL UNIQUE,
  date date,
  time time,
  sku text NOT NULL,
  qty numeric(12,2) NOT NULL DEFAULT 0,
  layers text,
  banding_type text[] NOT NULL DEFAULT '{}',
  product_type text[] NOT NULL DEFAULT '{}',
  pallet_size text[] NOT NULL DEFAULT '{}',
  notes text,
  quality_issue_type text,
  quality_issue_desc text,
  group_leader text,
  sachet_type text,
  tablet_type text,
  uom text,
  merch_history jsonb,
  batch_lot text,
  expiry_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  first_modified timestamptz,
  last_modified timestamptz,
  change_history text,
  modified_by text
);

CREATE UNIQUE INDEX tickets_serial_key ON tickets(serial);
CREATE INDEX tickets_sku_idx ON tickets(sku);
CREATE INDEX tickets_created_at_idx ON tickets(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- PALLETS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pallet_id text NOT NULL UNIQUE,
  pallet_type text NOT NULL DEFAULT 'Standard',
  original_ticket_serial text,
  zone_prefix text,
  current_zone text NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  sku text NOT NULL,
  product_type text,
  quantity numeric(12,2) NOT NULL DEFAULT 0,
  remaining_quantity numeric(12,2) NOT NULL DEFAULT 0,
  layers text,
  manufacturing_date date,
  batch_lot text,
  expiry_date date,
  shelf_life_days integer,
  parent_pallet_id text,
  child_pallets text[] NOT NULL DEFAULT '{}',
  photo_links text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_moved_at timestamptz,
  last_moved_by text,
  notes text,
  in_transit_to_zone text,
  in_transit_movement_id text,
  in_transit_initiated_at timestamptz,
  in_transit_initiated_by text
);

CREATE UNIQUE INDEX pallets_pallet_id_key ON pallets(pallet_id);
CREATE INDEX pallets_current_zone_idx ON pallets(current_zone);
CREATE INDEX pallets_sku_idx ON pallets(sku);
CREATE INDEX pallets_created_at_idx ON pallets(created_at);
CREATE INDEX pallets_batch_lot_idx ON pallets(batch_lot);
CREATE INDEX pallets_parent_pallet_id_idx ON pallets(parent_pallet_id);
CREATE INDEX pallets_in_transit_idx ON pallets(in_transit_to_zone) WHERE in_transit_to_zone IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ZONE MOVEMENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE zone_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id text NOT NULL UNIQUE,
  pallet_id text NOT NULL,
  from_zone text NOT NULL,
  to_zone text NOT NULL,
  movement_date date NOT NULL,
  movement_time time NOT NULL,
  moved_by text NOT NULL,
  reason text,
  override_reason text,
  quantity numeric(12,2),
  order_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  movement_status text NOT NULL DEFAULT 'In Transit',
  received_at timestamptz,
  received_by text,
  auto_reverted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_escalation_reason text
);

CREATE UNIQUE INDEX zone_movements_movement_id_key ON zone_movements(movement_id);
CREATE INDEX zone_movements_pallet_id_idx ON zone_movements(pallet_id);
CREATE INDEX zone_movements_from_zone_idx ON zone_movements(from_zone);
CREATE INDEX zone_movements_to_zone_idx ON zone_movements(to_zone);
CREATE INDEX zone_movements_created_at_idx ON zone_movements(created_at);
CREATE INDEX zone_movements_status_idx ON zone_movements(movement_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- BIN CARDS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE bin_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bin_card_id text NOT NULL,
  zone text NOT NULL,
  sku text NOT NULL,
  shift_date date NOT NULL,
  shift text NOT NULL,
  opening_balance numeric(12,2) NOT NULL DEFAULT 0,
  moved_in numeric(12,2) NOT NULL DEFAULT 0,
  moved_out numeric(12,2) NOT NULL DEFAULT 0,
  system_closing_balance numeric(12,2) NOT NULL DEFAULT 0,
  physical_count numeric(12,2) NOT NULL DEFAULT 0,
  variance numeric(12,2) NOT NULL DEFAULT 0,
  confirmed_by text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'Confirmed',
  revoked_by text,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX bin_cards_zone_shift_sku_idx ON bin_cards(zone, shift_date, shift, sku);
CREATE INDEX bin_cards_shift_date_idx ON bin_cards(shift_date);
CREATE INDEX bin_cards_zone_idx ON bin_cards(zone);

-- ─────────────────────────────────────────────────────────────────────────────
-- QA HOLD
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE qa_hold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id text NOT NULL UNIQUE,
  pallet_id text NOT NULL,
  hold_date date NOT NULL,
  hold_time time NOT NULL,
  reason text,
  held_by text,
  qa_reference text,
  status text NOT NULL,
  release_date date,
  released_by text,
  release_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX qa_hold_pallet_id_idx ON qa_hold(pallet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- REWORK
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE rework (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rework_id text NOT NULL UNIQUE,
  pallet_id text NOT NULL,
  rework_date date NOT NULL,
  rework_time time NOT NULL,
  rework_reason text,
  assigned_to text,
  status text NOT NULL,
  completed_date date,
  completed_by text,
  result text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rework_pallet_id_idx ON rework(pallet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- DISPATCH
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id text NOT NULL UNIQUE,
  order_reference text,
  pallet_id text,
  child_pallet_id text,
  assigned_date date,
  assigned_by text,
  vehicle_id text,
  driver_name text,
  driver_contact text,
  loading_date date,
  loading_by text,
  shipped_date date,
  shipped_by text,
  status text,
  proof_of_loading_photos text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dispatch_pallet_id_idx ON dispatch(pallet_id);
CREATE INDEX dispatch_order_reference_idx ON dispatch(order_reference);

-- ─────────────────────────────────────────────────────────────────────────────
-- USER ACTIVITY LOG
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE user_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  active_user_email text,
  effective_user_email text,
  additional_info text
);

CREATE INDEX user_activity_log_timestamp_idx ON user_activity_log(timestamp);

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER HELPER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at
CREATE TRIGGER trg_zone_config_updated_at
  BEFORE UPDATE ON zone_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sku_zone_mapping_updated_at
  BEFORE UPDATE ON sku_zone_mapping FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_authorized_users_updated_at
  BEFORE UPDATE ON authorized_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
