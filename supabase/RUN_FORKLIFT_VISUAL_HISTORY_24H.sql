-- RetiFlux™ — Forklift + recent movement visual history (last 24h)
-- Purpose:
--   - Populate `zone_movements` with forklift_id so `traffic-center.html` can render FL icons.
--   - Spread movement timestamps across the last 24 hours.
--
-- Run after any WH reseed that truncates `zone_movements` (e.g. RUN_RESEED_WH_MODEL_9K.sql).

BEGIN;

-- Remove only synthetic history rows (safe to re-run).
DELETE FROM zone_movements WHERE movement_id LIKE 'MOV-FL-RESEED-%';

-- Insert synthetic "received" movements.
-- We set from_zone/to_zone to the pallet's current_zone so forklift icons render in stable places.
INSERT INTO zone_movements (
  movement_id,
  pallet_id,
  from_zone,
  to_zone,
  movement_date,
  movement_time,
  moved_by,
  reason,
  override_reason,
  quantity,
  order_reference,
  notes,
  created_at,
  movement_status,
  received_at,
  received_by,
  forklift_id
)
SELECT
  'MOV-FL-RESEED-' || gen_random_uuid()::text AS movement_id,
  p.pallet_id,
  p.current_zone AS from_zone,
  p.current_zone AS to_zone,
  dt::date AS movement_date,
  dt::time AS movement_time,
  'Reseed Simulation' AS moved_by,
  NULLIF('','') AS reason,
  NULLIF('','') AS override_reason,
  COALESCE(p.remaining_quantity, p.quantity, 0)::numeric AS quantity,
  NULL AS order_reference,
  NULL AS notes,
  dt AS created_at,
  'Received' AS movement_status,
  dt + (floor(random() * 180) + 60) * interval '1 second' AS received_at,
  'Reseed Simulation' AS received_by,
  f.id AS forklift_id
FROM (
  SELECT pallet_id, current_zone, remaining_quantity, quantity
  FROM pallets
  WHERE current_zone IS NOT NULL
    AND (in_transit_to_zone IS NULL OR trim(in_transit_to_zone) = '')
  ORDER BY random()
  LIMIT 120
) p
-- Random dt within last 24 hours.
CROSS JOIN LATERAL (SELECT now() - (random() * interval '24 hours') AS dt) t
-- Random forklift pick (optional; leave forklift_id NULL if forklifts table is empty).
LEFT JOIN LATERAL (SELECT id FROM forklifts ORDER BY random() LIMIT 1) f ON true;

COMMIT;

-- Quick sanity checks:
-- SELECT COUNT(*) FROM zone_movements WHERE movement_id LIKE 'MOV-FL-RESEED-%';
-- SELECT forklift_code, current_zone FROM get_forklift_positions();

