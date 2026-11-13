# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # local dev server at http://localhost:5173 (includes /api/* routes via vite shim)
npm run build      # tsc + vite build
npm run preview    # preview production build
npm run sample     # regenerate data/sample/*.json (deterministic fictional dataset)
```

No test suite. Type-check only: `npx tsc --noEmit`.

## Architecture

**Stack:** React 19 + TypeScript + Tailwind v4 + Recharts, bundled by Vite. Deployed to Vercel (static + serverless functions).

### Data flow

```
Supabase (4 tables)  →  api/_bundle.js  →  api/data.js  →  browser fetch /api/data  →  src/lib/data.ts
```

- `api/_bundle.js` — shared server code. `isLive()` picks live vs sample. `liveBundle()` paginates Supabase via raw `fetch` (no SDK). `sampleBundle()` requires JSON from `data/sample/`.
- `api/data.js` — single `/api/data` endpoint; returns the whole bundle as JSON.
- `api/chat.js` — `/api/chat` endpoint; compacts last-30-days into a prompt and calls Claude.
- `api/login.js` — optional password gate; sets an httpOnly cookie (`gh_auth`).

In dev, `vite.config.ts` intercepts `/api/*` requests and runs the same handler files directly (no Vercel CLI needed).

**Mode switching:** if `GARMIN_SUPABASE_URL` + `GARMIN_SUPABASE_SERVICE_ROLE_KEY` are set → live Supabase. Otherwise → `data/sample/`. No code change needed.

### Front-end structure

- `src/App.tsx` — loads data once, handles login wall, owns the hash router and the shared `period` state (this-month / 30-days / this-year slicer that persists across pages).
- `src/lib/data.ts` — TypeScript types for every Supabase row (`WeighIn`, `Activity`, `Sleep`, `Daily`, `DexaScan`, `BloodPanel`, `BloodMarker`), plus `loadData()` and `Bundle`.
- `src/lib/metrics.ts` — activity bucketing (`Bucket` type, `bucketOf()`, `TYPE_MAP`), period window maths (`datasetNow`, `periods`, `PeriodKey`), and `ALL_BUCKETS`.
- `src/lib/plan.ts` — weekly training targets (`ActivityTarget`, `TrainingPlan`, `blankTarget`).
- `src/lib/racePlan.ts` — 16-week triathlon build plan. Change `RACE_DATE` here to re-date every week automatically.
- `src/lib/marker-info.ts` — blood marker reference ranges and descriptions (`MARKER_INFO`).
- `src/lib/next-panel.ts` — printable "ask-your-doctor" blood test request sheet template.
- `src/pages/` — one file per route; each receives `data: Bundle`, `now: Date`, `period`, `setPeriod`, `refreshed`.
- `src/ui.tsx` — shared chart constants (`AXIS_TICK`, `TOOLTIP`, `GRID`). Use these in every Recharts chart.
- `src/components/Nav.tsx` — sidebar nav with `NAV_SECTIONS`. `WorkWithUs` component also lives here.
- `src/components/ChatWidget.tsx` — floating chat bubble; calls `/api/chat`.

### Personalisation points

| What to change | File |
|---|---|
| Race date / weekly plan | `src/lib/racePlan.ts` (`RACE_DATE`) |
| Weekly training targets | `src/lib/plan.ts` |
| Blood test request sheet | `src/lib/next-panel.ts` |
| AI coach system prompt | bottom of `api/chat.js` |
| Nav sections | `src/components/Nav.tsx` (`NAV_SECTIONS`) |

### Environment variables (never `VITE_`-prefix secrets)

| Variable | Purpose |
|---|---|
| `GARMIN_SUPABASE_URL` | Supabase project URL |
| `GARMIN_SUPABASE_SERVICE_ROLE_KEY` | Server-side only; never in browser bundle |
| `GH_PASSWORD` | Dashboard password gate |
| `GH_SESSION_TOKEN` | Cookie value for the gate |
| `ANTHROPIC_API_KEY` | Enables AI coach |
| `ANTHROPIC_MODEL` | Defaults to `claude-haiku-4-5-20251001` |

Anything prefixed `VITE_` is inlined into the public bundle — never put keys there.
