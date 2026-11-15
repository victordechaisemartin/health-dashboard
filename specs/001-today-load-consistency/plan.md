# Implementation Plan: Today, Load & Consistency

**Branch**: `main` | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)

## Summary

Add coaching-grade KPIs to the health dashboard: a Today readiness card (HRV +
sleep + RHR verdict), a Load page (acute:chronic ratio, volume progression,
hard-day streak), and Consistency panels (streak, active days, sleep regularity,
strength sessions, weight trend). All logic lives in pure `src/lib/` functions,
unit-tested with vitest. No new Garmin endpoints — data already flows through
Supabase; only the HRV table (already synced) and the Sleep type extension
(FR-002) are needed to unblock Phase 1.

## Technical Context

**Language/Version**: TypeScript 5.7 (frontend), Python 3.x (ETL)

**Primary Dependencies**: React 19, Recharts 2.13, Tailwind v4, Vite 6 — no new
runtime dependencies. Vitest added as dev-only for unit tests (approved by
constitution III).

**Storage**: Supabase (PostgreSQL). Tables: `garmin_hrv` (already synced),
`garmin_activities`, `garmin_daily_summary`, `garmin_sleep`,
`garmin_weigh_ins` (FR-003, to be added).

**Testing**: `vitest run` via `npm test`. Type-check: `npx tsc --noEmit`. Both
are the quality gate (constitution III).

**Target Platform**: Browser (Vercel static + serverless), `localhost:5173` in dev.

**Project Type**: Web application (React SPA + Vercel API routes).

**Performance Goals**: Today card visible in under 5 seconds total page load
(SC-1). All KPI computation is synchronous over the in-memory Bundle — no
additional network calls after load.

**Constraints**: Secrets server-side only; no `VITE_`-prefix on any key
(constitution I). All date maths via `parseLocalDate` / local fields; never
`toISOString()` (constitution VII).

**Scale/Scope**: Single user, ~3 years of data (≤ 1500 activity rows, ≤ 1100
daily rows, ≤ 400 HRV rows at any given time).

## Constitution Check

| Principle | Gate | Status |
|-----------|------|--------|
| I. Privacy-First | No new direct browser→Supabase path; no VITE_-prefixed key | **PASS** — data flow unchanged |
| II. Single-Source Data Flow | `Bundle` gains `hrv: Hrv[]`; loaded once in `loadBundle()` | **PASS** |
| III. Minimal Footprint | `vitest` is the one approved test dependency | **PASS** |
| IV. Shared Visual Language | All Recharts charts MUST import `AXIS_TICK`, `TOOLTIP`, `GRID` | **MUST ENFORCE** in every chart component |
| V. Typed Boundaries | `Hrv` type added to `data.ts`; `Sleep` extended with `started_at`/`ended_at` | **PASS** |
| VI. Never Invent a Number | Every KPI function returns `{ value, status, rule, reason? }`; `reason` populated whenever `status === "na"` | **MUST ENFORCE** in every KPI function signature |
| VII. Local Time Is Truth | `today()` returns real Europe/Paris date; all week maths via `weekStart()` | **PASS** |
| VIII. Explicit Coaching Rules | All thresholds in `src/lib/targets.ts` with source citations | **PASS** |

No violations. No Complexity Tracking entry required.

## Project Structure

### Documentation (this feature)

```text
specs/001-today-load-consistency/
├── plan.md              ← this file
├── research.md          ← Phase 0 findings
├── data-model.md        ← Phase 1 types and entities
├── quickstart.md        ← Phase 1 validation guide
├── contracts/           ← KPI function signatures (internal contracts)
│   └── kpi-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md             ← Phase 2 output (/speckit-tasks)
```

### Source Code

```text
src/
├── lib/
│   ├── data.ts          MODIFY: add Hrv type, Sleep.started_at/ended_at,
│   │                             Bundle.hrv, lastRefreshed update
│   ├── metrics.ts       MODIFY: split weights→strength+mobility buckets,
│   │                             add today(), dataFreshness()
│   ├── targets.ts       NEW: all KPI thresholds with source citations
│   ├── weeks.ts         NEW: weekStart(), weeklySeries()
│   ├── kpis.ts          NEW: one pure function per KPI → KpiResult
│   ├── data.test.ts     NEW: (or existing) — extend with HRV/sleep types
│   ├── weeks.test.ts    NEW: edge-case tests (§6 items 1–6, 9–10, 12–13)
│   └── kpis.test.ts     NEW: KPI logic tests (§6 items 7–8, 11)
├── ui.tsx               MODIFY: extend Stat with status/rule props, add StatusDot
├── pages/
│   ├── Overview.tsx     MODIFY: add Today card + This Week section
│   ├── Load.tsx         NEW: /load page (KPI row + 3 charts + 14-day table)
│   ├── Recovery.tsx     MODIFY: add HRV chart with baseline band, RHR baseline line
│   ├── SleepPage.tsx    MODIFY: add rolling average line, bedtime scatter
│   └── Health.tsx       MODIFY: add weight rate KPI
└── components/
    └── Nav.tsx          MODIFY: add /load route under Recovery section

api/
├── _bundle.js           MODIFY: add garmin_hrv table fetch to loadBundle()

etl/
└── sync_personal_api.py MODIFY: add weigh-in sync (FR-003, pre-coding task required)
```

## Suggested Build Order

Following spec §Appendix A and the pre-task gates:

1. **FR-001/002/008** — `Hrv` type, `Sleep.started_at/ended_at`, `Bundle.hrv`,
   `today()`, `dataFreshness()`, `_bundle.js` HRV fetch. Unblocks all KPI work.
2. **FR-005/006/007** — `weeks.ts`, `targets.ts`, `vitest`, tests for §6 edge
   cases 1–6, 9–10, 12–13 (bucket/week/load logic).
3. **KPIs 4.1–4.4** — `kpis.ts` RHR, HRV, sleep, verdict. Today card on Overview.
4. **KPIs 4.5–4.8** — Acute:chronic, volume progression, hard-day streak,
   long-run share. Load page.
   - **Gate:** run pre-ship validation task (last 8 weeks session table, SC-4).
5. **KPIs 4.9–4.13** — Days-since, streak, active days, strength/mobility,
   intensity minutes. This Week section on Overview.
6. **KPI 4.14** — Sleep regularity, bedtime scatter. Sleep page additions.
7. **FR-003 + KPI 4.16** — Weigh-in ETL + weight rate KPI.
   - **Gate:** run pre-coding weight endpoint test first (confirm units).
8. **FR-004** — Bucket refactor (`weights` → `strength` + `mobility`).
   - **Gate:** run full Supabase `activity_type` count first; list unmapped types.
   - Do on its own branch or last — touches Nav, routes, and all existing pages.
