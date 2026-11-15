# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # local dev server at http://localhost:5173 (includes /api/* routes via vite shim)
npm run build      # tsc + vite build
npm run preview    # preview production build
npm test           # vitest run (pure metric/KPI functions in src/lib/)
```

Quality gate: `npx tsc --noEmit && npm test`. Both must pass before every commit.

## Architecture

**Stack:** React 19 + TypeScript + Tailwind v4 + Recharts, bundled by Vite. Deployed to Vercel (static + serverless functions).

### Data flow

```
Supabase (4 tables)  →  api/_bundle.js  →  api/data.js  →  browser fetch /api/data  →  src/lib/data.ts
```

- `api/_bundle.js` — shared server code. `loadBundle()` paginates Supabase via raw `fetch` (no SDK) with the `apikey` header; throws `NotConfiguredError` when env vars are missing.
- `api/data.js` — single `/api/data` endpoint. Returns 503 `{ error: "not_configured", missing }` with no config; 401 `{ error: "unprotected" }` when `VERCEL=1` but `GH_PASSWORD` is unset; 401 `{ error: "auth" }` when the session cookie is missing.
- `api/chat.js` — `/api/chat` endpoint; same guards; compacts last-30-days into a prompt and calls Claude.
- `api/login.js` — password gate; sets httpOnly cookie (`gh_auth`). Required on Vercel.

In dev, `vite.config.ts` intercepts `/api/*` requests and runs the same handler files directly (no Vercel CLI needed).

**No sample fallback.** If Supabase env vars are missing, the UI renders a setup screen listing them. There is no direct browser → Supabase path.

### Front-end structure

- `src/App.tsx` — loads data once, handles login wall, owns the hash router and the shared `period` state (this-month / 30-days / this-year slicer that persists across pages).
- `src/lib/data.ts` — TypeScript types for every Supabase row (`WeighIn`, `Activity`, `Sleep`, `Daily`, `DexaScan`, `BloodPanel`, `BloodMarker`), plus `loadData()` and `Bundle`.
- `src/lib/metrics.ts` — activity bucketing (`Bucket` type, `bucketOf()`, `TYPE_MAP`), period window maths (`datasetNow`, `periods`, `PeriodKey`), and `ALL_BUCKETS`.
- `src/lib/targets.ts` — all KPI thresholds as named exports; every constant has a source comment. **This is the single file to edit when tuning coaching rules.**
- `src/lib/weeks.ts` — `WeekSummary` type, `weekStart()`, `weeklySeries()`, `classifySession()`. Quality/long session classification lives here.
- `src/lib/kpis.ts` — all KPI functions (`rhrvBaseline`, `hrvStatus`, `sleepLast`, `todayVerdict`, `acuteChronicRatio`, `weeklyVolumeProgression`, `sleepRolling7d`, `bedtimeConsistency`, `weightRateOfChange`, etc.). Each returns `KpiResult` with `value`, `status`, `rule`, and optional `reason`.
- `src/lib/marker-info.ts` — blood marker reference ranges and descriptions (`MARKER_INFO`).
- `src/lib/next-panel.ts` — printable "ask-your-doctor" blood test request sheet template.
- `src/pages/` — one file per route; each receives `data: Bundle`, `now: Date`, `period`, `setPeriod`, `refreshed`.
- `src/ui.tsx` — shared chart constants (`AXIS_TICK`, `TOOLTIP`, `GRID`). Use these in every Recharts chart.
- `src/components/Nav.tsx` — sidebar nav with `NAV_SECTIONS`. `WorkWithUs` component also lives here.
- `src/components/ChatWidget.tsx` — floating chat bubble; calls `/api/chat`.

### Personalisation points

| What to change | File |
|---|---|
| KPI thresholds (coaching rules) | `src/lib/targets.ts` |
| Blood test request sheet | `src/lib/next-panel.ts` |
| AI coach system prompt | bottom of `api/chat.js` |
| Nav sections | `src/components/Nav.tsx` (`NAV_SECTIONS`) |

Race Plan and Training Plan pages render a single "No plan yet" card — no plan logic ships with the repo.

### Environment variables (never `VITE_`-prefix secrets)

| Variable | Purpose |
|---|---|
| `GARMIN_SUPABASE_URL` | Supabase project URL |
| `GARMIN_SUPABASE_SECRET_KEY` | `sb_secret_...` key; server-side only |
| `GARMIN_PERSONAL_API_KEY` | Garmin Personal API key (daily sync) |
| `GH_PASSWORD` | Dashboard password gate; **required on Vercel** |
| `GH_SESSION_TOKEN` | Cookie value for the gate |
| `ANTHROPIC_API_KEY` | Enables AI coach |
| `ANTHROPIC_MODEL` | Defaults to `claude-haiku-4-5-20251001` |

Two ETL entry points: `etl/load_export.py` (one-off GDPR import, cm/kJ units) and `etl/sync_personal_api.py` (daily Personal API sync, already m/s/kcal). The latter is called from `.github/workflows/garmin-sync.yml` on cron.

Anything prefixed `VITE_` is inlined into the public bundle — never put keys there.
