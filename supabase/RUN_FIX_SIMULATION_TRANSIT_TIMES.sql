UPDATE zone_movements
SET received_at = created_at + (random() * 1800 + 300)::int * interval '1 second'
WHERE movement_id LIKE 'MOV-SIM-%'
  AND (received_at IS NULL OR received_at < created_at);
