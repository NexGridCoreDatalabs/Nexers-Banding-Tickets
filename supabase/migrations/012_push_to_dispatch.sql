-- RetiFlux™ — Push to dispatch
-- Orders can be pushed to dispatch at 75%+ picking or when completed
-- SM clerk gets notified of 75%+ orders to prepare for release

ALTER TABLE orders ADD COLUMN IF NOT EXISTS pushed_to_dispatch_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pushed_to_dispatch_by text;

CREATE INDEX IF NOT EXISTS orders_pushed_to_dispatch_at_idx ON orders(pushed_to_dispatch_at) WHERE pushed_to_dispatch_at IS NOT NULL;

-- RPC: orders 75%+ done (IN_PROGRESS) — for SM clerk "Prepare for release" section
CREATE OR REPLACE FUNCTION get_orders_preparing_for_release()
RETURNS TABLE(id uuid, external_order_no text, customer_name text, assigned_picker_name text, total_lines bigint, done_lines bigint, progress_pct integer) AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.external_order_no, o.customer_name, o.assigned_picker_name, o.total_lines::bigint,
    (SELECT COUNT(*)::bigint FROM order_lines ol WHERE ol.order_id = o.id AND ol.status IN ('PICKED','SHORT')),
    (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id AND ol.status IN ('PICKED','SHORT')) * 100 / NULLIF(o.total_lines, 0)
  FROM orders o
  WHERE o.status = 'IN_PROGRESS' AND o.total_lines > 0
    AND (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id AND ol.status IN ('PICKED','SHORT')) * 100 / o.total_lines >= 75
  ORDER BY (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id AND ol.status IN ('PICKED','SHORT')) * 100.0 / o.total_lines DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_orders_preparing_for_release() TO anon;
