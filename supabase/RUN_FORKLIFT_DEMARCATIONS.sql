-- RetiFlux™ — Forklift demarcations: FL-320 to FL-325 (warehouse), FL-326/FL-327 (dispatch)
-- Run in Supabase SQL Editor to align forklifts with your warehouse layout

-- Remove legacy forklifts if present
DELETE FROM forklifts WHERE forklift_code IN ('FL-01', 'FL-02', 'FL-03');

-- Insert demarcated forklifts
INSERT INTO forklifts (forklift_code, name, status) VALUES
  ('FL-320', 'Forklift 320', 'available'),
  ('FL-321', 'Forklift 321', 'available'),
  ('FL-322', 'Forklift 322', 'available'),
  ('FL-323', 'Forklift 323', 'available'),
  ('FL-324', 'Forklift 324', 'available'),
  ('FL-325', 'Forklift 325', 'available'),
  ('FL-326', 'Dispatch FL 326', 'available'),
  ('FL-327', 'Dispatch FL 327', 'available')
ON CONFLICT (forklift_code) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();
