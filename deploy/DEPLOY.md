# Deploy the frontend from this folder (Vercel CLI)

Backend stays on Supabase; this repo is the static site. Build writes `config.js` from **environment variables** (never commit real keys).

## 1) What you need before deploying

| Item | Where to get it |
|------|-----------------|
| **SUPABASE_URL** | Supabase → Project **Settings** → **API** → Project URL |
| **SUPABASE_ANON_KEY** | Same page → **Project API keys** → `anon` **public** |

Optional (only if you use those features): Google Sheet ID, Apps Script URL, generator password, etc. See `deploy/env.example`.

## 2) Install Vercel CLI (once)

```bash
npm i -g vercel
```

Or use `npx vercel` without global install.

## 3) Log in

```bash
vercel login
```

Follow the browser/email prompt.

## 4) From this project root

```bash
cd path/to/Nexers-Banding-Tickets-TEMP
vercel link
```

- First time: create/link a Vercel project (scope = your team, project name = e.g. `nexers-banding-tickets`).
- This creates `.vercel/` (gitignored).

## 5) Add environment variables on Vercel

**Dashboard (easiest):** [vercel.com](https://vercel.com) → your **Project** → **Settings** → **Environment Variables**

Add at least:

- `SUPABASE_URL` = your Project URL  
- `SUPABASE_ANON_KEY` = anon key  
- `SCAN_BASE_URL` = `https://retifluxtm.vercel.app/` (public origin for **js/retiflux-qr.js** — PRT print labels, cover sheets; avoids localhost in QRs when testing locally)

Enable for **Production** (and **Preview** if you use preview URLs).

**CLI alternative:**

```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
```

Paste values when prompted; choose Production (and Preview if needed).

## 6) Production deploy from your machine

```bash
vercel --prod
```

CLI prints the live URL. Production app: [https://retifluxtm.vercel.app](https://retifluxtm.vercel.app/).

## 7) Supabase checklist

- **Authentication** (if used): add your Vercel URL under **URL Configuration** allowed redirect URLs.
- **RLS**: anon key only sees what policies allow (already your backend concern).

## 8) Git (optional)

Push the same repo to GitHub and connect it in Vercel → **Git** for automatic deploys on every push to `main`.
