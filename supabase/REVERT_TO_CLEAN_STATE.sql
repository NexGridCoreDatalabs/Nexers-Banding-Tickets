-- Run this in Supabase SQL Editor to restore the database to a clean state.
-- Removes all migration 022 changes (resolve_order_id, text overloads, _impl renames).
-- Restores original: check_order_availability(uuid) and release_pallet_reservations(uuid) only.

-- Drop everything we added
DROP FUNCTION IF EXISTS check_order_availability(text);
DROP FUNCTION IF EXISTS release_pallet_reservations(text);
DROP FUNCTION IF EXISTS resolve_order_id(text);

-- If _impl exists, rename back to original (restore from 019)
DO $$
BEGIN
  ALTER FUNCTION check_order_availability_impl(uuid) RENAME TO check_order_availability;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$
BEGIN
  ALTER FUNCTION release_pallet_reservations_impl(uuid) RENAME TO release_pallet_reservations;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- Ensure grants
GRANT EXECUTE ON FUNCTION check_order_availability(uuid) TO anon;
GRANT EXECUTE ON FUNCTION release_pallet_reservations(uuid) TO anon;
