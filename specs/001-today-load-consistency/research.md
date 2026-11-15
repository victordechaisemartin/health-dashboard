# Research: Today, Load & Consistency

**Date**: 2026-11-15 | **Feature**: [spec.md](spec.md)

## Finding 1 — HRV sync already complete

**Decision**: `garmin_hrv` is already synced by `etl/sync_personal_api.py`.
No new ETL work needed for FR-001 beyond the TypeScript side.

**Evidence**: `sync_personal_api.py` lines 209–224 define `parse_hrv()` mapping
`calendarDate → hrv_date`, `lastNightAvg → last_night_avg`,
`baseline.balancedLow/Upper → baseline_low/baseline_high`, `status → status`.
Lines 362–364 upsert to `garmin_hrv` on `hrv_date`.

**Rationale**: FR-001 only requires adding the TypeScript `Hrv` type to
`src/lib/data.ts`, fetching `garmin_hrv` in `api/_bundle.js`, and adding
`hrv: Hrv[]` to `Bundle`.

**Alternatives considered**: None — the data is already there.

---

## Finding 2 — Sleep `started_at` / `ended_at` already written to DB

**Decision**: `parse_sleep()` in `sync_personal_api.py` already writes
`started_at` and `ended_at` (from `sleepStartTimestampGMT` /
`sleepEndTimestampGMT`, converted to UTC ISO). The TypeScript `Sleep` type
in `src/lib/data.ts` does not expose them yet — that is the entirety of FR-002.

**Rationale**: Adding two optional fields to the `Sleep` type is a one-line
change. The `load_export.py` ETL also writes these fields (it sets `started_at`
from epoch ms via `epoch_ms_to_iso`).

**Note**: Both loaders store `started_at`/`ended_at` in UTC. The bedtime
consistency KPI (§4.14) must convert to Europe/Paris local time before computing
the standard deviation — do not use the raw UTC value.

---

## Finding 3 — Personal API units are already SI (weight likely kg)

**Decision**: Treat Personal API weight values as kg until the pre-coding test
(FR-003 gate) confirms. Do NOT apply `g_to_kg()` conversion in the initial
implementation; add a `# TODO: confirm units` comment so the gate is visible.

**Evidence**: `sync_personal_api.py` line 8 comment: "Units from the Personal API
are already SI / human-readable (meters, seconds, kilocalories) — do NOT reuse
the GDPR export's centimetre / kilojoule conversions." Weight is a body
measurement (like resting HR, not a workout metric), so the Personal API's
"human-readable" claim is likely kilograms. The GDPR export uses grams because it
mirrors the raw device protocol.

**Risk**: If the endpoint does return grams, every stored `weight_kg` value will
be ~70× too large. The pre-coding gate is mandatory before FR-003 ships.

**Alternatives considered**: Apply `g_to_kg()` as the GDPR loader does → rejected
because the API header explicitly warns against it, and it would corrupt data if
the endpoint already returns kg.

---

## Finding 4 — Activity type mapping (full history unverified)

**Decision**: Accept the proposed split (strength/mobility) using the current
`TYPE_MAP` as the starting set. Add a pre-refactor task to run the full DB query
before the FR-004 bucket change lands.

**Evidence from test data**: The 7-day API test sample contains only
`cycling`, `hiking`, `multi_sport`, `running`, `walking`. This confirms the
existing TYPE_MAP covers all outdoor types. Strength/yoga/pilates types are
present in Victor's real data (they appear in the current TYPE_MAP) but cannot be
independently verified without the DB query.

**Rationale**: FR-004 touches `metrics.ts`, `Nav.tsx`, and all pages that
reference buckets. Running the query first prevents a silent "null bucket" bug
for any activity type that exists in real data but not in TYPE_MAP.

---

## Finding 5 — `today()` and `datasetNow()` are distinct functions

**Decision**: Add a new `today()` function that returns the real local date in
Europe/Paris, leaving the existing `datasetNow()` unchanged.

**Rationale**: `datasetNow()` anchors to the most recent data point to keep
charts meaningful on static snapshots. `today()` is for the Today card verdict,
which must use the real calendar date (spec §1 principle 5). They serve different
purposes and must not be merged.

**Implementation**: `today()` = `new Date()` with no adjustment needed in a
browser context (the browser's locale is Europe/Paris for this user), or use
`Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" })` to extract the
date string safely.

---

## Finding 6 — `weekStart()` local Monday rule

**Decision**: `weekStart(date)` returns the Monday of the week containing `date`,
using local midnight (consistent with `parseLocalDate`).

**Algorithm**:
```ts
function weekStart(d: Date): Date {
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // Mon=0 offset
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return m;
}
```

**Edge cases covered**: DST (the `new Date(y, m, d)` constructor uses local
midnight, so DST transitions don't create a 23 h or 25 h "day"). Sunday correctly
maps to the previous Monday (diff = -6).

---

## Finding 7 — Vitest integration

**Decision**: Add `vitest` as the sole approved test dev-dependency. Test files
live alongside their source: `src/lib/weeks.test.ts`, `src/lib/kpis.test.ts`.

**Script**: `"test": "vitest run"` in `package.json` (non-watch mode for CI).

**No `vite.config.ts` change needed**: Vitest discovers `*.test.ts` files
automatically. The existing Vite config is TypeScript-based and compatible.

---

## Deferred / Out of scope

| Item | Status |
|------|--------|
| Weight endpoint unit confirmation | Pre-coding gate; test before FR-003 ships |
| Full `activity_type` DB count | Pre-refactor gate; run before FR-004 ships |
| §4.7 quality/long session validation (SC-4) | Pre-ship gate; generate 8-week table before hard-day KPI ships |
