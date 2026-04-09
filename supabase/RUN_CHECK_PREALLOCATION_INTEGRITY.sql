-- RetiFlux™ — Pre-allocation integrity checks
-- Safe to run any time (read-only).

-- 1) Functions present (ensure expected signatures)
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('check_order_availability','check_order_availability_alloc','get_available_sm_qty_for_order')
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY proname, args;

-- 2) Active reservations that reference missing pallets/orders/lines
SELECT pr.*
FROM pallet_reservations pr
LEFT JOIN orders o ON o.id = pr.order_id
LEFT JOIN order_lines ol ON ol.id = pr.order_line_id
LEFT JOIN pallets p ON p.pallet_id = pr.pallet_id
WHERE pr.released_at IS NULL
  AND (o.id IS NULL OR p.pallet_id IS NULL OR (pr.order_line_id IS NOT NULL AND ol.id IS NULL))
LIMIT 200;

-- 3) Pallets reserved by multiple *orders* concurrently (should be zero)
SELECT pr.pallet_id,
       COUNT(DISTINCT pr.order_id) AS order_count,
       ARRAY_AGG(DISTINCT pr.order_id) AS orders
FROM pallet_reservations pr
WHERE pr.released_at IS NULL
GROUP BY pr.pallet_id
HAVING COUNT(DISTINCT pr.order_id) > 1
ORDER BY order_count DESC
LIMIT 200;

-- 4) Reservations with non-positive qty (should be zero)
SELECT *
FROM pallet_reservations
WHERE released_at IS NULL
  AND COALESCE(quantity_reserved, 0) <= 0
LIMIT 200;

-- 5) Pending replenishment tasks missing reserved pallet (should be rare/zero)
SELECT rt.*
FROM replenishment_tasks rt
LEFT JOIN pallets p ON p.pallet_id = rt.reserved_pallet_id
WHERE rt.status = 'PENDING'
  AND rt.reserved_pallet_id IS NOT NULL
  AND p.pallet_id IS NULL
LIMIT 200;

