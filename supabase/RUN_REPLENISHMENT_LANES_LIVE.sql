-- RetiFlux™ — Live replenishment lanes view for clerk UIs
-- Purpose:
--   Provide lane-first visibility: what is needed downstream, what is available upstream,
--   and which task/pallet is next to execute.

DROP FUNCTION IF EXISTS get_replenishment_lanes_live(text);

CREATE FUNCTION get_replenishment_lanes_live(p_to_zone text DEFAULT NULL)
RETURNS TABLE (
  to_zone text,
  from_zone text,
  sku text,
  trigger_reason text,
  priority int,
  remaining_qty numeric,
  pallets_remaining int,
  source_available_qty numeric,
  source_available_pallets int,
  next_task_id text,
  next_reserved_pallet_id text,
  next_sm_notified_at timestamptz,
  next_sm_notified_by text
) AS $$
BEGIN
  RETURN QUERY
  WITH open_tasks AS (
    SELECT
      rt.task_id,
      rt.from_zone,
      rt.to_zone,
      rt.sku,
      rt.trigger_reason,
      rt.priority,
      COALESCE(rt.quantity_needed, 0)::numeric AS quantity_needed,
      rt.reserved_pallet_id,
      rt.sm_notified_at,
      rt.sm_notified_by,
      rt.created_at
    FROM replenishment_tasks rt
    WHERE rt.status IN ('PENDING','IN_PROGRESS')
      AND rt.task_type IN ('ZONE_REPLENISH','SM_REPLENISH','ORDER_PICK')
      AND (p_to_zone IS NULL OR rt.to_zone = p_to_zone)
  ),
  lane_rollup AS (
    SELECT
      ot.to_zone,
      ot.from_zone,
      ot.sku,
      MIN(ot.priority) AS priority,
      MIN(ot.trigger_reason) AS trigger_reason,
      COALESCE(SUM(ot.quantity_needed), 0)::numeric AS remaining_qty,
      COUNT(*)::int AS pallets_remaining,
      (ARRAY_AGG(ot.task_id ORDER BY ot.priority ASC, ot.created_at ASC))[1] AS next_task_id,
      (ARRAY_AGG(ot.reserved_pallet_id ORDER BY ot.priority ASC, ot.created_at ASC))[1] AS next_reserved_pallet_id,
      -- Any task in the lane may be notified; MAX keeps the button "Notified" for the whole lane.
      MAX(ot.sm_notified_at) AS next_sm_notified_at,
      (ARRAY_AGG(ot.sm_notified_by ORDER BY ot.sm_notified_at DESC NULLS LAST))[1] AS next_sm_notified_by
    FROM open_tasks ot
    GROUP BY ot.to_zone, ot.from_zone, ot.sku
  ),
  source_avail AS (
    SELECT
      p.current_zone AS from_zone,
      p.sku,
      COALESCE(SUM(COALESCE(p.remaining_quantity, p.quantity, 0)), 0)::numeric AS source_available_qty,
      COUNT(*)::int AS source_available_pallets
    FROM pallets p
    WHERE (p.in_transit_to_zone IS NULL OR trim(p.in_transit_to_zone) = '')
      AND COALESCE(p.remaining_quantity, p.quantity, 0) > 0
    GROUP BY p.current_zone, p.sku
  )
  SELECT
    lr.to_zone,
    lr.from_zone,
    lr.sku,
    lr.trigger_reason,
    lr.priority,
    lr.remaining_qty,
    lr.pallets_remaining,
    COALESCE(sa.source_available_qty, 0)::numeric AS source_available_qty,
    COALESCE(sa.source_available_pallets, 0)::int AS source_available_pallets,
    lr.next_task_id,
    lr.next_reserved_pallet_id,
    lr.next_sm_notified_at,
    lr.next_sm_notified_by
  FROM lane_rollup lr
  LEFT JOIN source_avail sa
    ON sa.from_zone = lr.from_zone
   AND sa.sku = lr.sku
  ORDER BY lr.priority ASC, lr.to_zone, lr.from_zone, lr.sku;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_replenishment_lanes_live(text) TO anon;

-- Quick check:
-- SELECT * FROM get_replenishment_lanes_live('SuperMarket Area') LIMIT 200;
