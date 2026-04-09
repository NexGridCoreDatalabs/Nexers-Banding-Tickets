-- RetiFlux™ — Fix: accept UUID, external_order_no, or pallet_id for check_order_availability
-- Run this ONCE in Supabase SQL Editor. Resolves "invalid input syntax for type uuid: SM-20260317-02533"

-- Step 1: Clean up any previous partial state
DROP FUNCTION IF EXISTS check_order_availability(text);
DROP FUNCTION IF EXISTS release_pallet_reservations(text);
DROP FUNCTION IF EXISTS resolve_order_id(text);

-- Step 2: Rename uuid versions to _uuid (internal only)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
             WHERE n.nspname = 'public' AND p.proname = 'check_order_availability') THEN
    ALTER FUNCTION check_order_availability(uuid) RENAME TO check_order_availability_uuid;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
             WHERE n.nspname = 'public' AND p.proname = 'release_pallet_reservations') THEN
    ALTER FUNCTION release_pallet_reservations(uuid) RENAME TO release_pallet_reservations_uuid;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Handle _impl names (from previous migration attempts)
DO $$
BEGIN
  ALTER FUNCTION check_order_availability_impl(uuid) RENAME TO check_order_availability_uuid;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$
BEGIN
  ALTER FUNCTION release_pallet_reservations_impl(uuid) RENAME TO release_pallet_reservations_uuid;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- Step 3: Create resolver
CREATE OR REPLACE FUNCTION resolve_order_id(p_input text)
RETURNS uuid AS $$
DECLARE v_uuid uuid;
BEGIN
  IF p_input IS NULL OR trim(p_input) = '' THEN
    RAISE EXCEPTION 'Order ID is required';
  END IF;
  BEGIN
    v_uuid := p_input::uuid;
    RETURN v_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    NULL;
  END;
  SELECT id INTO v_uuid FROM orders WHERE external_order_no = p_input LIMIT 1;
  IF FOUND THEN RETURN v_uuid; END IF;
  SELECT order_id INTO v_uuid FROM order_pallets WHERE pallet_id = p_input LIMIT 1;
  IF FOUND THEN RETURN v_uuid; END IF;
  RAISE EXCEPTION 'Order not found. Use order UUID, external order number, or pallet ID. Got: %', p_input;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Create text-only public API (no overload)
CREATE OR REPLACE FUNCTION check_order_availability(p_order_id text)
RETURNS jsonb AS $$
BEGIN
  RETURN check_order_availability_uuid(resolve_order_id(p_order_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION release_pallet_reservations(p_order_id text)
RETURNS int AS $$
DECLARE v_count int;
BEGIN
  v_count := release_pallet_reservations_uuid(resolve_order_id(p_order_id));
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Permissions: only text versions are public
REVOKE EXECUTE ON FUNCTION check_order_availability_uuid(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION release_pallet_reservations_uuid(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION check_order_availability(text) TO anon;
GRANT EXECUTE ON FUNCTION release_pallet_reservations(text) TO anon;
