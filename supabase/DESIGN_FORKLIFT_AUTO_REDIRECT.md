# Forklift auto-redirect when capacity frees up (design)

## Current behavior

`movement_initiate` runs in one transaction: it inserts `zone_movements`, marks the pallet in transit, then calls `assign_forklift_to_movement`. If no forklift is available it **raises** and the **whole transaction rolls back** — there is no stranded movement and nothing in the DB records “this clerk tried to start a move and failed.”

So today, **FORKLIFT_AVAILABLE** notifications are the main signal to retry.

## Goal

When a forklift becomes **available**, nudge operations so that FL is **physically heading toward** the zone that has **ready work** (pallet on floor, valid move, clerk waiting), reducing dead time before the next `movement_initiate`.

## Options (pick one path)

### A) **Soft dispatch (recommended first step)**

- Add nullable columns on `forklifts`, e.g. `staging_target_zone text`, `staging_reason text`, `staging_set_at timestamptz`, `staging_movement_hint jsonb` (optional).
- **Client or small RPC** after a failed initiate (catch error string “No available forklift”): insert a row into `forklift_staging_requests` **or** update a queue table keyed by `(from_zone, pallet_id)` with `status = 'WAITING_FL'`.
- Trigger **`trg_forklifts_on_available`**: when `status` goes to `available`, pick the highest-priority queue row whose `from_zone` matches fleet rules, set `staging_target_zone = from_zone` (pickup zone), and insert a **zone_clerk_notifications** row: “Forklift X — proceed to [zone] for pending move.”
- **No automatic `movement_initiate`** until you trust the rules; the clerk still confirms. This stays safe and auditable.

### B) **Hard auto-initiate (later / optional)**

- Refactor flow so **forklift is reserved before** the pallet is marked in transit (split `movement_initiate` or add `movement_initiate_reserving` that returns `need_fl` vs `ok`).
- Or: on FL available, run a **SECURITY DEFINER** function that finds one eligible pending intent and calls `movement_initiate` as `system`. Higher risk (wrong pallet, race with clerk UI).

### C) **Heuristic without queue**

- On FL available, scan `replenishment_tasks` + `pallets` for “obvious” next move. Fragile (multiple SKUs, priorities, partial pallets).

## Recommendation

Implement **A**: a small **queue or staging hint** table plus notification (and optional `forklifts.staging_target_zone` for Highway animation). Wire the **zone clerk UI** to enqueue on failed initiate. Then extend **get_forklift_positions** / Highway to draw “staging” FLs along the edge toward `staging_target_zone`.

## Implemented (soft dispatch)

- **`supabase/RUN_FORKLIFT_SOFT_DISPATCH.sql`** — `forklift_staging_queue`, `forklifts.staging_*`, `enqueue_forklift_staging_intent` RPC, `pick_staging_queue_for_forklift`, merged **`trg_forklifts_notify_available`** (staging match skips generic FORKLIFT_AVAILABLE), extended busy trigger (dismiss staging + consume queue + clear staging).
- **`app/zone-clerk.html`** — on initiate error containing “no available forklift”, calls `enqueue_forklift_staging_intent`.
- **`supabase/RUN_FORKLIFT_POSITIONS.sql`** — returns `staging_target_zone`, `staging_queue_id`, `staging_set_at`.
- **`app/traffic-center.html`** — cyan “staging” pill animates from inferred zone toward `staging_target_zone` while FL is still `available`.

Run order: forklifts + zone notifications triggers exist → **`RUN_FORKLIFT_SOFT_DISPATCH.sql`** → **`RUN_FORKLIFT_POSITIONS.sql`** (drop/recreate `get_forklift_positions`).

## Overlapping Highway routes

Handled in `traffic-center.html` by offsetting segments that share the same **undirected** zone pair (e.g. both `A→B` and `B→A`). Further de-overlap for unrelated pairs that share geometry would need midpoint/angle bucketing.
