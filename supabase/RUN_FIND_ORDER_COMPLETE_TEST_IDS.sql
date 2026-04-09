-- RetiFlux™ — Find test orders for completion guard
-- Finds at least:
--   - one order that the guard would allow to be marked COMPLETED
--   - one order that the guard would reject
--
-- Run after RUN_ORDER_COMPLETE_GUARD.sql is installed.

CREATE OR REPLACE FUNCTION try_assert_order_can_complete(p_order_id text)
RETURNS jsonb AS $$
BEGIN
  BEGIN
    PERFORM assert_order_can_complete(p_order_id);
    RETURN jsonb_build_object('ok', true, 'error', null);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Top 20: show guard result for recent orders
SELECT
  o.id,
  o.status,
  (res->>'ok')::boolean AS can_complete,
  res->>'error' AS guard_error
FROM orders o
CROSS JOIN LATERAL try_assert_order_can_complete(o.id::text) AS res
ORDER BY can_complete DESC, o.updated_at DESC
LIMIT 20;

-- One guaranteed "should pass" candidate (if any exist)
SELECT
  o.id,
  o.status,
  res->>'error' AS guard_error
FROM orders o
CROSS JOIN LATERAL try_assert_order_can_complete(o.id::text) AS res
WHERE (res->>'ok')::boolean = true
ORDER BY o.updated_at DESC
LIMIT 1;

-- One guaranteed "should fail" candidate (if any exist)
SELECT
  o.id,
  o.status,
  res->>'error' AS guard_error
FROM orders o
CROSS JOIN LATERAL try_assert_order_can_complete(o.id::text) AS res
WHERE (res->>'ok')::boolean = false
ORDER BY o.updated_at DESC
LIMIT 1;

