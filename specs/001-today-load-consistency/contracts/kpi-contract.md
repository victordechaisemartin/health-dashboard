# KPI Function Contracts

**Date**: 2026-11-15 | **Feature**: [spec.md](../spec.md)

All functions live in `src/lib/kpis.ts` and are pure (no side effects, no
imports from React). Each takes a `Bundle` (or slice of it) plus `today: Date`
and returns `KpiResult` (defined in `data-model.md` §4).

---

## Signature catalogue

```ts
// §4.1
function rhrvBaseline(daily: Daily[], today: Date): KpiResult
// value: today's resting_hr delta vs 30-day mean ("+3 bpm")
// target: "–3 bpm to +3 bpm" (ok band); reason when < 14 baseline days

// §4.2
function hrvStatus(hrv: Hrv[], today: Date): KpiResult
// value: last night's last_night_avg (ms); target: baseline band
// status derived from consecutive LOW/UNBALANCED nights

// §4.3
function sleepLast(sleep: Sleep[], today: Date): KpiResult
// value: total_sleep_s for sleep_date === today (hours); target: 7.5 h
// act only on second consecutive < 6 h night

// §4.4
function todayVerdict(
  rhr: KpiResult, hrv: KpiResult, sleep: KpiResult
): KpiResult
// value: "Go" | "Easy" | "Rest / easy only" | null (no verdict)
// rule: concatenated triggering rule strings

// §4.5
function acuteChronicRatio(daily: Daily[], today: Date): KpiResult
// value: ratio (1 decimal); target band: 0.8–1.3
// na if chronic === 0 or fewer than 21 days covered in last 28

// §4.6
function weeklyVolumeProgression(
  weeks: WeekSummary[], today: Date
): { hours: KpiResult; runKm: KpiResult }
// compares last completed week to max of prior 4; na during current week

// §4.7
function hardDayStreak(weeks: WeekSummary[], today: Date): KpiResult
// value: consecutive hard days ending today or yesterday
// limit: ok ≤ 1 · watch 2 · act ≥ 3

function qualitySessionsThisWeek(weeks: WeekSummary[], today: Date): KpiResult
// value: quality session count in current week; target: ≤ 3

// §4.8
function longRunShare(weeks: WeekSummary[], today: Date): KpiResult
// value: longest run km / total run km (last completed week, %)
// na if < 3 runs in that week

// §4.9
function daysSinceSport(
  activities: Activity[], today: Date
): Record<"swim" | "bike" | "run" | "strength", KpiResult>

// §4.10
function weeklyTrainingStreak(weeks: WeekSummary[], today: Date): KpiResult
// value: current streak (weeks); also returns bestStreak in rule text

// §4.11
function activeDaysYtd(
  activities: Activity[], today: Date
): { ytd: KpiResult; prevYtd: KpiResult; thisWeek: KpiResult }

// §4.12
function strengthMobilityThisWeek(weeks: WeekSummary[], today: Date): KpiResult

// §4.13
function intensityMinutesThisWeek(daily: Daily[], today: Date): KpiResult
// value: Σ(moderate_min + 2×vigorous_min) Mon→today; target: 150

// §4.14
function sleepRolling7d(sleep: Sleep[], today: Date): KpiResult
function bedtimeConsistency(sleep: Sleep[], today: Date): KpiResult
// value: SD of local bedtime over last 14 nights (minutes)

// §4.16
function weightRateOfChange(weighIns: WeighIn[], today: Date): KpiResult
// value: linear regression slope (kg/week) over last 28 days
// na if < 4 weigh-ins in window
```

---

## Invariants (must hold for every function)

1. Returns a `KpiResult` — never throws.
2. If `value === null`, `reason` MUST be set (constitution VI).
3. If `status === "na"`, `value` MUST be `null` and `reason` MUST be set.
4. No `Date` to ISO string conversion inside KPI functions — use `parseLocalDate`
   and local field comparisons only (constitution VII).
5. All threshold comparisons reference `targets.ts` constants — no inline
   magic numbers (constitution VIII).
