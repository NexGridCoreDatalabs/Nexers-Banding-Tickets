-- RetiFlux™ — Fix RPC ambiguity for check_order_availability
--
-- Error fixed:
--   Could not choose best candidate between check_order_availability(text) and (uuid)
--
-- Strategy:
--   1) Rename uuid overload to internal name: check_order_availability_uuid(uuid)
--   2) Keep one public RPC function: check_order_availability(text)
--   3) Wrapper resolves UUID / external_order_no / order pallet id, then calls internal uuid function

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_order_availability'
      AND pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid'
  ) THEN
    BEGIN
      EXECUTE 'ALTER FUNCTION public.check_order_availability(uuid) RENAME TO check_order_availability_uuid';
    EXCEPTION WHEN duplicate_function THEN
      -- Already renamed on a previous run.
      NULL;
    END;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.check_order_availability(p_order_id text)
RETURNS jsonb AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF p_order_id IS NULL OR trim(p_order_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order id');
  END IF;

  -- 1) Try UUID text directly
  BEGIN
    v_order_id := p_order_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_order_id := NULL;
  END;

  -- 2) Try external order no
  IF v_order_id IS NULL THEN
    SELECT o.id INTO v_order_id
    FROM orders o
    WHERE o.external_order_no = p_order_id
    LIMIT 1;
  END IF;

  -- 3) Try order pallet id
  IF v_order_id IS NULL THEN
    SELECT op.order_id INTO v_order_id
    FROM order_pallets op
    WHERE op.pallet_id = p_order_id
    LIMIT 1;
  END IF;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found for identifier: ' || p_order_id);
  END IF;

  -- Delegate to the SM-first single-source implementation.
  RETURN public.check_order_availability_uuid(v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.check_order_availability(text) TO anon;

