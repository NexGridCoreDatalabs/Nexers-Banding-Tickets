# RetiFlux™ — Supabase Setup

## Quick Start

### 1. Install Supabase CLI

```powershell
# Windows (Scoop)
scoop install supabase

# Or via npm
npm install -g supabase
```

### 2. Link to Your Project (Hosted)

If you have a Supabase project at [supabase.com](https://supabase.com):

```powershell
cd c:\Users\USER\Desktop\Nexers-Banding-Tickets-TEMP
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### 3. Run Migrations

```powershell
# Push schema to hosted project
supabase db push

# Or run locally first
supabase start
supabase db reset   # Applies migrations + seed
```

### 4. Get Your Keys

```powershell
supabase status
```

Copy the **API URL** and **anon key** into `.env` (from `.env.example`).

---

## Local Development

```powershell
supabase start    # Starts local Postgres, API, Studio, etc.
supabase status   # Shows URLs and keys
supabase db reset # Reset DB, run migrations + seed
supabase stop     # Stop local services
```

**Local URLs (default):**
- API: http://127.0.0.1:54321
- Studio: http://127.0.0.1:54323
- DB: postgresql://postgres:postgres@127.0.0.1:54322/postgres

---

## Configuration

| File | Purpose |
|------|---------|
| `config.toml` | Local Supabase config — pooling, auth, ports |
| `migrations/` | SQL migrations (schema, indexes, functions) |
| `seed/` | Seed data (zone_config, zone_transitions) |

**Tuned for:** 250+ concurrent users, max security (see `docs/POSTGRES_SCHEMA_AND_MIGRATION.md`).
