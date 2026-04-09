# Nexers Banding Tickets · RetiFlux™

Client-side warehouse UI for **NexGridCore DataLabs**. Supabase-backed flows (PRT, zone clerk, traffic center, etc.).

## Repository

- **Remote:** `https://github.com/NexGridCoreDatalabs/Nexers-Banding-Tickets.git`
- **Default branch:** `main`

## First-time clone & config

1. Copy `config.example.js` → `config.js` and set `SUPABASE_URL` / `SUPABASE_ANON_KEY` (and other keys you use).
2. Do **not** commit `config.js` (it stays gitignored).

```bash
git clone https://github.com/NexGridCoreDatalabs/Nexers-Banding-Tickets.git
cd Nexers-Banding-Tickets
copy config.example.js config.js
# edit config.js
```

## Push workflow

```bash
git status
git add -A
git commit -m "Describe your change in a full sentence."
git push origin main
```

## Deployments

| Target | Notes |
|--------|--------|
| **Vercel (CLI from this folder)** | Step-by-step: **`deploy/DEPLOY.md`**. Set env vars (see **`deploy/env.example`**). Then `vercel --prod`. |
| **Vercel (Git)** | Connect repo in Vercel dashboard; same env vars. |
| **GitHub Pages** | Workflow `.github/workflows/deploy.yml` injects `config.js` from **GitHub Actions secrets** (`SUPABASE_*` + legacy Google keys). |

### Repo layout (frontend deploy)

- **Root** — `index.html`, shared `css/`, `js/`, `config.example.js`, `vercel.json`
- **`app/`** — app screens (traffic center, PRT, zone clerk, …)
- **`supabase/`** — SQL only (not executed by Vercel; your Supabase project already runs the backend)
- **`deploy/`** — env template + Vercel CLI instructions
- **`scripts/`** — `vercel-inject-config.mjs` (used at build on Vercel)

## Supabase

SQL helpers live under `supabase/`. Apply migrations in your Supabase project as needed.
