# Data Model: Today, Load & Consistency

**Date**: 2026-11-15 | **Feature**: [spec.md](spec.md)

All types live in `src/lib/data.ts` (Supabase row shapes) or
`src/lib/kpis.ts` / `src/lib/weeks.ts` (computed shapes). No schema
migrations are required for HRV, sleep, activities, or daily — the tables and
ETL are already correct. Only `garmin_weigh_ins` needs the new weigh-in ETL
(FR-003, gated).

---

## 1. New Supabase row type — `Hrv`

Add to `src/lib/data.ts`:

```ts
export type Hrv = {
  hrv_date: string;             // "YYYY-MM-DD", primary key
  last_night_avg: number | null;
  last_night_5min_high: number | null;
  weekly_avg: number | null;
  baseline_low: number | null;  // balancedLow from Garmin baseline object
  baseline_high: number | null; // balancedUpper
  status: string | null;        // "BALANCED" | "LOW" | "UNBALANCED" | "NO_STATUS"
  created_at?: string | null;
};
```

---

## 2. `Sleep` type extension (FR-002)

Add two optional fields to the existing `Sleep` type in `src/lib/data.ts`:

```ts
export type Sleep = {
  // …existing fields…
  started_at?: string | null;   // UTC ISO — sleepStartTimestampGMT
  ended_at?: string | null;     // UTC ISO — sleepEndTimestampGMT
};
```

Both are already written by both ETL loaders; this change only exposes them to
TypeScript.

---

## 3. `Bundle` extension (FR-001)

```ts
export type Bundle = {
  // …existing fields…
  hrv: Hrv[];                   // garmin_hrv, optional-loaded (falls back to [])
};
```

`loadBundle()` in `api/_bundle.js` fetches `garmin_hrv` ordered by `hrv_date`
and uses `.catch(() => [])` so a missing table does not break the bundle.
`lastRefreshed()` in `src/lib/data.ts` gains an `hrv: Hrv[]` scan.

---

## 4. Computed type — `KpiResult`

Lives in `src/lib/kpis.ts`. Every KPI function returns this shape:

```ts
export type KpiStatus = "ok" | "watch" | "act" | "na";

export type KpiResult = {
  value: number | string | null;  // null triggers the "–" display
  unit?: string;                  // "bpm", "h", "ms", etc.
  target?: number | string;       // shown alongside value
  status: KpiStatus;
  rule: string;                   // plain-language tooltip text
  reason?: string;                // populated when status === "na"; shown instead of "–" alone
};
```

**Constitution VI enforcement**: every KPI function MUST set `reason` when
`value === null` or `status === "na"`. The UI renders `– reason` for those cells.

---

## 5. `WeekSummary` — per-week aggregation

Lives in `src/lib/weeks.ts`:

```ts
export type WeekSummary = {
  weekStart: string;      // "YYYY-MM-DD", local Monday
  inProgress: boolean;    // true for the current incomplete week
  byBucket: Record<Bucket, {
    sessions: number;
    hours: number;
    km: number;
    load: number;
    longestDurationS: number;
    longestKm: number;
    qualitySessions: number;  // sessions matching §4.7 quality rule
    longSessions: number;     // sessions matching §4.7 long rule
  }>;
  hardDays: number;       // distinct local dates with ≥ 1 quality or long session
  activeDays: number;     // distinct local dates with ≥ 1 activity (inc. hike)
  totalHours: number;     // sum across training buckets (not hiking)
  totalLoad: number;
};
```

---

## 6. `DataFreshness` — data staleness helper

Lives in `src/lib/metrics.ts` (alongside `datasetNow`):

```ts
export type DataFreshness = {
  summaryDate: string | null;   // newest garmin_daily_summary.summary_date
  sleepDate: string | null;     // newest garmin_sleep.sleep_date
  hrvDate: string | null;       // newest garmin_hrv.hrv_date
};
```

---

## 7. Existing types used unchanged

| Type | Where | Notes |
|------|-------|-------|
| `Activity` | `data.ts` | `aerobic_te`, `anaerobic_te` already present |
| `Daily` | `data.ts` | `resting_hr`, `moderate_min`, `vigorous_min` already present |
| `WeighIn` | `data.ts` | No change; `weight_kg` field already correct |
| `Bucket` | `metrics.ts` | Extended: `"weights"` renamed/split to `"strength"` + `"mobility"` in FR-004 |

---

## 8. `targets.ts` constants (not a data model, but referenced everywhere)

New file `src/lib/targets.ts`. Every threshold is a named constant with a
comment citing its source. Example structure:

```ts
// Coaching rule §2 (coaching-method.md)
export const WEEKLY_VOLUME_LIMIT_PCT = 10;
export const WEEKLY_VOLUME_LIMIT_LOW_BASE_PCT = 15; // base < 4 h
export const ACWR_OK_MAX = 1.3;
export const ACWR_WATCH_MAX = 1.5;

// defaults — not in coaching-method.md; review after 4 weeks
export const RHR_WATCH_BPM = 3;
export const RHR_ACT_BPM = 5;
export const SLEEP_TARGET_S = 7.5 * 3600;
export const SLEEP_ACT_S = 6 * 3600;
export const BEDTIME_WATCH_STD_MIN = 30;
export const BEDTIME_ACT_STD_MIN = 60;
export const STRENGTH_SESSION_TARGET = 2;
export const WEEKLY_COUNTING_SESSIONS = 3; // Q2 default
export const WEIGHT_WATCH_LOSS_KG_WEEK = 0.5;
export const WEIGHT_ACT_LOSS_KG_WEEK = 1.0;
```
