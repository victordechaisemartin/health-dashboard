# Personal Garmin dashboard

My private health dashboard: activities, sleep, resting HR, steps, body comp
off the Garmin Index S2, and blood panels. Reads from my Supabase, served
through gated serverless routes. No sample data, no public demo.

## Prereqs

- Node 20+
- A Supabase project with the schemas in `sql/` applied
- A Garmin data export (or whatever source you point the ETL at)

## Env vars

Copy `.env.example` to `.env` and fill in:

| Variable | What it is |
|---|---|
| `GARMIN_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `GARMIN_SUPABASE_SECRET_KEY` | A `sb_secret_...` key. Server-side only. |
| `GARMIN_PERSONAL_API_KEY` | Garmin Personal API key (see "Daily sync" below) |
| `GH_PASSWORD` | Dashboard access code. **Required on Vercel.** |
| `GH_SESSION_TOKEN` | Session cookie value. **Required when `GH_PASSWORD` is set, must be ≥ 32 chars** (e.g. `openssl rand -hex 32`). Short / missing values are treated as unconfigured. |

Never prefix a secret with `VITE_` — anything so prefixed is inlined into the
browser bundle.

## Supabase setup

In the Supabase SQL editor, paste these two files once:

1. `sql/schema.sql` — garmin tables + dexa_scans, RLS on, grants revoked from
   `anon`/`authenticated`.
2. `sql/blood_panels.sql` — blood_panels table, same rules.

Nothing is readable through the anon/publishable key. Only the secret key
(which bypasses RLS) can read, and that lives only in server env vars.

## Load data

Two loaders, for two scenarios.

### Daily sync (Garmin Personal API)

Request a Personal API key at https://connect.garmin.com/app/settings/personalApiToken
and put it in `.env` as `GARMIN_PERSONAL_API_KEY`. Then:

```bash
python etl/sync_personal_api.py --dry-run --days 7   # fetch + map, no writes
python etl/sync_personal_api.py --days 14            # backfill last 14 days
python etl/sync_personal_api.py                      # default: last 3 days
```

The sync upserts to `garmin_activities`, `garmin_daily_summary`,
`garmin_sleep`, `garmin_weigh_ins` (Index S2 scale only — manual entries are
skipped), and `garmin_hrv`. Activities paginate until the oldest row on a page
predates the window, so a long `--days` run gets the whole history. Running it
twice is harmless.

Every run writes a row to `garmin_sync_runs` (`status` = `ok`/`failed`,
per-endpoint `counts`, `error` text). The dashboard nav badge reads the latest
row and turns amber when the last run failed or is older than 36 h. The script
exits non-zero on any endpoint or upsert failure, so the GitHub Action goes red.
A 204/no-data response is NOT a failure.

A GitHub Action in `.github/workflows/garmin-sync.yml` runs it daily at
05:15 UTC. It uses three repo secrets: `GARMIN_PERSONAL_API_KEY`,
`GARMIN_SUPABASE_URL`, `GARMIN_SUPABASE_SECRET_KEY`. Trigger it manually
from the Actions tab (or `gh workflow run garmin-sync.yml -f days=14`).

### Bulk import (Garmin GDPR export, one-off)

From a Garmin GDPR export (`Account → Export Your Data`):

```bash
python etl/load_export.py --export "/path/to/export"              # parse + dump JSON into data/
python etl/load_export.py --export "/path/to/export" --supabase   # also upsert to Supabase
```

`data/raw/` and `data/*.json` are gitignored.

## Run it

```bash
npm install
npm run dev     # http://localhost:5173
```

With no `.env`, the dashboard renders a setup screen listing the missing env
vars. Set `GARMIN_SUPABASE_URL` + `GARMIN_SUPABASE_SECRET_KEY` and it loads.

## Deploy (Vercel)

```bash
npm i -g vercel
vercel deploy --prod
```

Set all env vars in the Vercel project settings before the first deploy.
`GH_PASSWORD` is enforced on Vercel: `/api/data` returns 401 until it is set.

## Layout

```
api/            Serverless routes: data (bundle), login (gate)
src/            Vite + React 19 + TypeScript + Tailwind v4 + Recharts
  pages/        one file per page
  lib/          data types, period maths, blood marker reference
etl/            load_export.py (Garmin export → Supabase)
sql/            schema.sql, blood_panels.sql
```

---

Based on [garmin-claude-dashboard](https://github.com/aaronparton2-sketch/garmin-claude-dashboard) by Aaron Automates (MIT).
