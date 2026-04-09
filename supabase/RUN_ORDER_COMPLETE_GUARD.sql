-- RetiFlux™ — Guardrail: only allow COMPLETED when all lines are terminal
-- Terminal lines for completion:
--   - PICKED
--   - SHORT
-- Not allowed:
--   - OPEN
--   - PICKER_REPORTED_SHORT (awaiting supervisor decision)

CREATE OR REPLACE FUNCTION assert_order_can_complete(p_order_id text)
RETURNS jsonb AS $$
DECLARE
  v_order_id uuid;
  v_open int;
  v_reported int;
  v_bad_picked int;
  v_bad_short int;
  v_pending_tasks int;
BEGIN
  IF p_order_id IS NULL OR trim(p_order_id) = '' THEN
    RAISE EXCEPTION 'Order ID is required';
  END IF;

  BEGIN
    v_order_id := p_order_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- allow external order no
    SELECT id INTO v_order_id
    FROM orders
    WHERE external_order_no = p_order_id
    LIMIT 1;

    IF v_order_id IS NULL THEN
      -- allow pallet id -> order id
      SELECT order_id INTO v_order_id
      FROM order_pallets
      WHERE pallet_id = p_order_id
      LIMIT 1;
    END IF;

    IF v_order_id IS NULL THEN
      RAISE EXCEPTION 'Order not found for id: %', p_order_id;
    END IF;
  END;

  SELECT COUNT(*) INTO v_open
  FROM order_lines
  WHERE order_id = v_order_id
    AND status = 'OPEN';

  SELECT COUNT(*) INTO v_reported
  FROM order_lines
  WHERE order_id = v_order_id
    AND status = 'PICKER_REPORTED_SHORT';

  IF v_open > 0 OR v_reported > 0 THEN
    RAISE EXCEPTION 'Cannot complete order: % OPEN line(s), % picker-reported short line(s) remaining', v_open, v_reported;
  END IF;

  -- Replenishment/task integration:
  -- If fulfillment-related ORDER_LINE replenishment tasks are still pending,
  -- do not allow the order to move to COMPLETED (prevents "short ignored").
  SELECT COUNT(*) INTO v_pending_tasks
  FROM replenishment_tasks
  WHERE order_id = v_order_id
    AND status IN ('PENDING','IN_PROGRESS')
    AND trigger_reason = 'ORDER_LINE';

  IF v_pending_tasks > 0 THEN
    RAISE EXCEPTION 'Cannot complete order: % fulfillment task(s) still pending', v_pending_tasks;
  END IF;

  -- Quantity consistency checks:
  -- - If a line is marked PICKED, it must have picked_quantity >= quantity
  -- - If a line is marked SHORT, it must have picked_quantity < quantity
  SELECT COUNT(*) INTO v_bad_picked
  FROM order_lines
  WHERE order_id = v_order_id
    AND status = 'PICKED'
    AND COALESCE(picked_quantity, 0) < COALESCE(quantity, 0);

  SELECT COUNT(*) INTO v_bad_short
  FROM order_lines
  WHERE order_id = v_order_id
    AND status = 'SHORT'
    AND COALESCE(picked_quantity, 0) >= COALESCE(quantity, 0);

  IF v_bad_picked > 0 OR v_bad_short > 0 THEN
    RAISE EXCEPTION 'Cannot complete order: % line(s marked PICKED but under-picked; % line(s marked SHORT but not under-picked)', v_bad_picked, v_bad_short;
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION assert_order_can_complete(text) TO anon;

-- 3) Hard server-side enforcement via trigger
-- This prevents any client-side path from setting orders.status='COMPLETED'
-- while order_lines / replenishment_tasks still violate the integrity rules.
CREATE OR REPLACE FUNCTION enforce_orders_completed_integrity()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM assert_order_can_complete(NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_orders_completed_integrity ON orders;
CREATE TRIGGER trg_orders_completed_integrity
BEFORE UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status = 'COMPLETED')
EXECUTE FUNCTION enforce_orders_completed_integrity();

