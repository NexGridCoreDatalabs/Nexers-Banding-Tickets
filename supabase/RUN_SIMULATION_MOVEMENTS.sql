INSERT INTO zone_movements (
  movement_id,
  pallet_id,
  from_zone,
  to_zone,
  movement_date,
  movement_time,
  moved_by,
  quantity,
  movement_status,
  created_at,
  received_at,
  received_by
)
SELECT
  'MOV-SIM-' || p.pallet_id AS movement_id,
  p.pallet_id,
  'Receiving Area' AS from_zone,
  p.current_zone AS to_zone,
  (current_date - (random() * 14)::int) AS movement_date,
  ('00:00'::time + (random() * 86400)::int * interval '1 second')::time AS movement_time,
  'Simulation' AS moved_by,
  COALESCE(p.remaining_quantity, p.quantity, 100) AS quantity,
  'Received' AS movement_status,
  t.initiated_at AS created_at,
  t.initiated_at + (random() * 1800 + 300)::int * interval '1 second' AS received_at,
  'Simulation' AS received_by
FROM pallets p,
  LATERAL (SELECT current_timestamp - (random() * 14 * 86400)::int * interval '1 second' AS initiated_at) t
WHERE p.current_zone IN (
  'Detergents Zone', 'Fats Zone', 'Liquids/Oils Zone', 'Soaps Zone',
  'Foods & Beverages Zone', 'SuperMarket Area'
)
  AND (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
  AND NOT EXISTS (
    SELECT 1 FROM zone_movements m
    WHERE m.movement_id = 'MOV-SIM-' || p.pallet_id
  )
ON CONFLICT (movement_id) DO NOTHING;
