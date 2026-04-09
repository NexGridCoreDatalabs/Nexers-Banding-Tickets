# RetiFlux™ — Supabase SQL Setup Checklist

Run these in **Supabase SQL Editor** in order.

---

## First-time setup (schema + seed)

| Step | File | Purpose |
|------|------|---------|
| 1 | `RUN_IN_SQL_EDITOR.sql` | Creates tables: pallets, zone_config, zone_transitions, zone_movements, etc. |
| 2 | `RUN_SEED_ONLY.sql` | Inserts zone config + zone transitions (routing rules) |
| 3 | `RUN_MOVEMENT_SUPABASE.sql` | movement_initiate, movement_receive, RLS, grants |

---

## Traffic Center + Auto-Revert

| Step | File | Purpose |
|------|------|---------|
| 4 | `RUN_TRAFFIC_CENTER_FULL.sql` | movement_auto_revert (15 min), traffic_highway_counts, traffic_avg_transit_seconds |

---

## Optional indexes (performance)

| Step | File | Purpose |
|------|------|---------|
| 5 | `RUN_INDEX_ZONE_OVERVIEW.sql` | Index for View All Zones / Traffic Center |

---

## Auto-revert scheduling

**15 min rule:** If a pallet is not received within 15 minutes of initiate, it auto-reverts to origin.

**Option A — pg_cron (Supabase Pro):**  
In SQL Editor, run:
```sql
SELECT cron.schedule(
  'retiflux-auto-revert',
  '*/5 * * * *',
  $$SELECT movement_auto_revert()$$
);
```

**Option B — External cron:**  
Call `supabase.rpc('movement_auto_revert')` every 5 minutes via:
- GitHub Actions
- Vercel Cron
- Supabase Edge Function + cron trigger

**Option C — Manual:**  
Traffic Center can have a "Run auto-revert" button that calls the RPC.

---

## Quick reference: run order

```
1. RUN_IN_SQL_EDITOR.sql
2. RUN_SEED_ONLY.sql
3. RUN_MOVEMENT_SUPABASE.sql
4. RUN_TRAFFIC_CENTER_FULL.sql
5. RUN_INDEX_ZONE_OVERVIEW.sql  (optional)
6. pg_cron schedule (optional, if Pro)
```
