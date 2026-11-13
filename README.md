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
| `GH_PASSWORD` | Dashboard access code. **Required on Vercel.** |
| `GH_SESSION_TOKEN` | Any long random string (session cookie value) |
| `ANTHROPIC_API_KEY` | Optional — enables the AI chat widget |
| `ANTHROPIC_MODEL` | Optional — defaults to `claude-haiku-4-5-20251001` |

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
`GH_PASSWORD` is enforced on Vercel: `/api/data` and `/api/chat` return 401
until it is set.

## AI coach

The chat bubble posts to `api/chat.js`, which compacts the last 30 days of
data and asks Claude. Read-only. Without `ANTHROPIC_API_KEY` the widget shows
a short "add your key" note.

## Layout

```
api/            Serverless routes: data (bundle), chat (coach), login (gate)
src/            Vite + React 19 + TypeScript + Tailwind v4 + Recharts
  pages/        one file per page
  lib/          data types, period maths, blood marker reference
etl/            load_export.py (Garmin export → Supabase)
sql/            schema.sql, blood_panels.sql
```

---

Based on [garmin-claude-dashboard](https://github.com/aaronparton2-sketch/garmin-claude-dashboard) by Aaron Automates (MIT).
