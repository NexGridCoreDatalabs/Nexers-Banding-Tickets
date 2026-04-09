-- RetiFlux™ — Forklift positions & history-safe release
-- Run this in Supabase SQL Editor after forklift migrations.

-- 1) Do NOT clear forklift_id on zone_movements when a movement is received.
--    We only mark the forklift as available so history (FL column, trails) stays intact.
CREATE OR REPLACE FUNCTION release_forklift_from_movement(p_movement_id text)
RETURNS jsonb AS $$
DECLARE
  v_fl_id uuid;
BEGIN
  IF NULLIF(trim(p_movement_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing movement_id');
  END IF;

  SELECT forklift_id INTO v_fl_id FROM zone_movements WHERE movement_id = p_movement_id;
  IF v_fl_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'released', false, 'message', 'No forklift was assigned');
  END IF;

  -- Keep zone_movements.forklift_id for history; only flip status back to available
  UPDATE forklifts SET status = 'available', updated_at = now() WHERE id = v_fl_id;

  RETURN jsonb_build_object('success', true, 'released', true, 'forklift_id', v_fl_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION release_forklift_from_movement(text) TO anon;

-- 2) Forklift positions: infer current_zone and in_transit from latest movements
DROP FUNCTION IF EXISTS get_forklift_positions();
CREATE OR REPLACE FUNCTION get_forklift_positions()
RETURNS TABLE (
  forklift_id uuid,
  forklift_code text,
  forklift_name text,
  status text,
  current_zone text,
  in_transit boolean,
  has_order boolean,
  active_order_reference text,
  is_dispatch_fleet boolean,
  return_zone text,
  dispatch_arrived_at timestamptz,
  last_movement_at timestamptz,
  staging_target_zone text,
  staging_queue_id uuid,
  staging_set_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  WITH last_mov AS (
    SELECT
      zm.forklift_id,
      zm.from_zone,
      zm.to_zone,
      zm.movement_status,
      zm.order_reference,
      zm.created_at,
      zm.received_at,
      ROW_NUMBER() OVER (PARTITION BY zm.forklift_id ORDER BY zm.created_at DESC) AS rn
    FROM zone_movements zm
    WHERE zm.forklift_id IS NOT NULL
  ),
  prev_mov AS (
    SELECT * FROM last_mov WHERE rn = 2
  )
  SELECT
    f.id AS forklift_id,
    f.forklift_code,
    f.name AS forklift_name,
    f.status,
    CASE
      WHEN lm.movement_status = 'In Transit' AND lm.from_zone IS NOT NULL THEN lm.from_zone
      WHEN lm.to_zone IS NOT NULL THEN lm.to_zone
      ELSE CASE
        WHEN f.forklift_code IN ('FL-326', 'FL-327') THEN 'Dispatch Loading Area'
        ELSE 'Receiving Area'
      END
    END AS current_zone,
    (lm.movement_status = 'In Transit') AS in_transit,
    ((lm.movement_status = 'In Transit')
      AND NULLIF(trim(COALESCE(lm.order_reference, '')), '') IS NOT NULL) AS has_order,
    lm.order_reference AS active_order_reference,
    (f.forklift_code IN ('FL-326', 'FL-327')) AS is_dispatch_fleet,
    CASE
      WHEN lm.to_zone = 'Dispatch Loading Area' THEN COALESCE(pm.to_zone, lm.from_zone)
      ELSE NULL
    END AS return_zone,
    CASE
      WHEN lm.to_zone = 'Dispatch Loading Area' THEN COALESCE(lm.received_at, lm.created_at)
      ELSE NULL
    END AS dispatch_arrived_at,
    COALESCE(lm.received_at, lm.created_at) AS last_movement_at,
    f.staging_target_zone,
    f.staging_queue_id,
    f.staging_set_at
  FROM forklifts f
  LEFT JOIN last_mov lm
    ON lm.forklift_id = f.id AND lm.rn = 1
  LEFT JOIN prev_mov pm
    ON pm.forklift_id = f.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_forklift_positions() TO anon;

-- Debug: see what the UI will use
-- (Run this after applying the function)
-- SELECT forklift_code, current_zone, in_transit, has_order, active_order_reference, last_movement_at
-- FROM get_forklift_positions()
-- ORDER BY last_movement_at DESC NULLS LAST
-- LIMIT 50;

