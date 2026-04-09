-- RetiFlux™ PRT — Auto-create pallet when ticket is logged
-- Run in Supabase SQL Editor
-- Links ticket.serial = pallet.pallet_id = pallet.original_ticket_serial
--
-- Prerequisite: Run RUN_ADD_RECORDED_BY.sql first (adds recorded_by to tickets)

CREATE OR REPLACE FUNCTION create_pallet_from_ticket()
RETURNS TRIGGER AS $$
DECLARE
  shelf_days integer;
BEGIN
  -- Compute shelf life (days) from mfg date and expiry date if both present
  shelf_days := NULL;
  IF NEW.date IS NOT NULL AND NEW.expiry_date IS NOT NULL THEN
    shelf_days := (NEW.expiry_date - NEW.date)::integer;
  END IF;

  INSERT INTO pallets (
    pallet_id,
    original_ticket_serial,
    pallet_type,
    current_zone,
    status,
    sku,
    product_type,
    quantity,
    remaining_quantity,
    layers,
    manufacturing_date,
    batch_lot,
    expiry_date,
    shelf_life_days,
    created_by,
    notes
  ) VALUES (
    NEW.serial,
    NEW.serial,
    'Banded',
    'Receiving Area',
    'Active',
    NEW.sku,
    CASE WHEN array_length(NEW.product_type, 1) > 0 THEN NEW.product_type[1] ELSE NULL END,
    COALESCE(NEW.qty, 0),
    COALESCE(NEW.qty, 0),
    NEW.layers,
    NEW.date,
    NEW.batch_lot,
    NEW.expiry_date,
    shelf_days,
    NEW.recorded_by,
    NEW.notes
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if present (idempotent)
DROP TRIGGER IF EXISTS trg_create_pallet_from_ticket ON tickets;

-- Attach trigger to tickets INSERT
CREATE TRIGGER trg_create_pallet_from_ticket
  AFTER INSERT ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION create_pallet_from_ticket();
