# Tasks: Today, Load & Consistency

**Input**: Design documents from `specs/001-today-load-consistency/`
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Data model**: [data-model.md](data-model.md)
**Contracts**: [contracts/kpi-contract.md](contracts/kpi-contract.md) | **Quickstart**: [quickstart.md](quickstart.md)

Tests are included — explicitly required by spec FR-007 and SC-5.

---

## Phase 1: Setup

**Purpose**: Vitest quality gate. Must complete before any test tasks can run.

- [ ] T001 Add `vitest` to `devDependencies` and `"test": "vitest run"` to `scripts` in `package.json`

**Checkpoint**: `npm test` runs (zero tests, clean exit).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: TypeScript types, bundle loading, shared utilities, and week-series logic that every KPI phase depends on.

**⚠️ CRITICAL**: No KPI work (Phase 3+) can begin until T002–T008 are complete.

- [ ] T002 [P] Extend `src/lib/data.ts`: add `Hrv` type (`hrv_date`, `last_night_avg`, `last_night_5min_high`, `weekly_avg`, `baseline_low`, `baseline_high`, `status`, `created_at?`); add `started_at?: string | null` and `ended_at?: string | null` to `Sleep`; add `hrv: Hrv[]` to `Bundle`; extend `lastRefreshed()` to scan `b.hrv` rows
- [ ] T003 [P] Add `garmin_hrv` table fetch (order by `hrv_date`, `.catch(() => [])` fallback) to `loadBundle()` in `api/_bundle.js`; include `hrv` in the returned bundle object (follow existing `dexa` pattern)
- [ ] T004 [P] Add `today(): Date` (real local date in Europe/Paris via `Intl.DateTimeFormat`) and `DataFreshness` type + `dataFreshness(bundle: Bundle): DataFreshness` to `src/lib/metrics.ts`
- [ ] T005 [P] Create `src/lib/targets.ts` with all KPI thresholds from spec §4 as named exports; every constant MUST have a source comment citing `coaching-method.md §N` or `"default"`; include at minimum: `WEEKLY_VOLUME_LIMIT_PCT`, `ACWR_OK_MAX`, `ACWR_WATCH_MAX`, `RHR_WATCH_BPM`, `RHR_ACT_BPM`, `SLEEP_TARGET_S`, `SLEEP_ACT_S`, `BEDTIME_WATCH_STD_MIN`, `BEDTIME_ACT_STD_MIN`, `STRENGTH_SESSION_TARGET`, `WEEKLY_COUNTING_SESSIONS`, `WEIGHT_WATCH_LOSS_KG_WEEK`, `WEIGHT_ACT_LOSS_KG_WEEK`
- [ ] T006 Create `src/lib/weeks.ts`: export `WeekSummary` type (per data-model.md §5), `weekStart(d: Date): Date` (local Monday, handles Sunday correctly), `weeklySeries(activities: Activity[], nWeeks: number, today: Date): WeekSummary[]`; apply hiking exclusion: hikes (`activity_type === "hiking"`) are excluded from quality/long classification unless `anaerobic_te >= 2.0`; mark current week as `inProgress: true`
- [ ] T007 Create stub `src/lib/kpis.ts` exporting `KpiStatus = "ok" | "watch" | "act" | "na"` and `KpiResult` type (per data-model.md §4); add a JSDoc comment: `reason` MUST be set whenever `value === null` or `status === "na"` (constitution VI)
- [ ] T008 Write `src/lib/weeks.test.ts` covering spec §6 edge cases: 1 (activity at 23:30 Sunday → correct week), 2 (DST boundary weeks — 29 Mar and 25 Oct 2026), 3 (multisport: swim/bike/run legs each count once, no double-count), 4–5 (recovery-week rebound: 5,5,5,3,5h → 0% increase vs baseline 5h; low base: 3h → 3.4h → 13% < 15% limit → ok), 9 (week with 1 run → longRunShare n/a), 10 (indoor ride 0 km → counts for hours/load, ignored for km), 12 (hike aerobic_te 4.2 / anaerobic_te 0.8 → quality: false, long: false), 13 (2h run aerobic_te 3.8 → long: true)

**Checkpoint**: `npm test` passes all weeks.test.ts cases; `npx tsc --noEmit` clean.

---

## Phase 3: US-1 — Morning Check (Priority: P1) 🎯 MVP

**Goal**: Today card on Overview showing Go/Easy/Rest verdict with HRV, RHR, and sleep signals.

**Independent Test**: Open Overview → Today card renders with a verdict and triggering rule text. With stale data (oldest summary_date > 1 day), card shows "No data since {date}" and no verdict.

### Implementation for US-1

- [ ] T009 [US1] Add `rhrvBaseline(daily: Daily[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.1: 30-day RHR mean baseline (≥ 14 values required), delta vs today's resting_hr; status ok < +3 / watch +3–4 / act ≥ +5 bpm; reason when < 14 days of data
- [ ] T010 [US1] Add `hrvStatus(hrv: Hrv[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.2: last night's `last_night_avg` vs Garmin `baseline_low`/`baseline_high` band; consecutive LOW/UNBALANCED logic for `act` (2+ consecutive nights); reason when no HRV row for today
- [ ] T011 [US1] Add `sleepLast(sleep: Sleep[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.3: `total_sleep_s` for `sleep_date === today`; target 7.5 h; `act` only on second consecutive night < 6 h; reason when no sleep row for today
- [ ] T012 [US1] Add `todayVerdict(rhr: KpiResult, hrv: KpiResult, sleep: KpiResult): KpiResult` to `src/lib/kpis.ts` per spec §4.4 verdict table; concatenate triggering rule strings into `rule`; value null + reason "HRV and sleep missing" when both are na
- [ ] T013 [US1] Write tests for §4.1–4.4 in `src/lib/kpis.test.ts` covering spec §6 edge cases: 7 (watch not worn 3 days → RHR baseline still works with ≥ 14 values; HRV consecutive-nights counts only consecutive dates), 8 (bedtimes 23:40 and 00:20 → spread 40 min not 23 h — test via bedtime consistency helper), 11 (no daily row for today → Today card shows yesterday's resting HR labelled "yesterday")
- [ ] T014 [P] [US1] Extend `Stat` component in `src/ui.tsx` with optional `status?: KpiStatus` and `rule?: string` props; add `StatusDot` component (coloured dot: ok=green, watch=amber, act=red, na=grey); when `value` is null, render "–" followed by the `reason` string
- [ ] T015 [US1] Add Today card section to `src/pages/Overview.tsx` above the sport cards per §5.1 wireframe; call `today()`, `dataFreshness()`, `rhrvBaseline()`, `hrvStatus()`, `sleepLast()`, `todayVerdict()`; show "Data as of {time}" freshness stamp; show steps progress vs step_goal (§4.15, info only); show days-since swim/bike/run/strength (using placeholder until T024 ships)

**Checkpoint**: US-1 independently testable — Today card shows verdict or stale-data message; `npm test` and `npx tsc --noEmit` pass.

---

## Phase 4: US-2 — Load Safety (Priority: P1)

**Goal**: /load page with acute:chronic ratio, volume progression, hard-day streak, long-run share, 16-week chart.

**Independent Test**: Navigate to /load → KPI row renders with coloured status dots; 16-week stacked chart renders; 14-day session table renders; `npm test` covers recovery-week rebound and chronic=0 edge cases.

### Implementation for US-2

- [ ] T016 [US2] Add `acuteChronicRatio(daily: Daily[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.5: 7-day acute / (28-day ÷ 4) chronic; na if chronic = 0 or fewer than 21 of last 28 days covered; bands from `targets.ts`; label "approximation — replaced by Garmin's own ratio in Phase 3"
- [ ] T017 [US2] Add `weeklyVolumeProgression(weeks: WeekSummary[], today: Date): { hours: KpiResult; runKm: KpiResult }` to `src/lib/kpis.ts` per spec §4.6: baseline = max of prior 4 completed weeks; limit from `targets.ts` (10%, or 15% if baseline < 4 h); current week shows "so far" with no status; also flag "volume and intensity up together" note
- [ ] T018 [US2] Add `hardDayStreak(weeks: WeekSummary[], today: Date): KpiResult` and `qualitySessionsThisWeek(weeks: WeekSummary[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.7; thresholds from `targets.ts`
- [ ] T019 [US2] Add `longRunShare(weeks: WeekSummary[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.8: na if < 3 runs in last completed week; tooltip notes coaching exception for ultra/trail blocks
- [ ] T020 [US2] Write tests for §4.5–4.8 in `src/lib/kpis.test.ts` covering spec §6 edge cases: 4 (recovery-week rebound: 5,5,5,3,5h → 0% vs baseline 5h), 5 (low base: 3h → 3.4h → ok at 15% limit), 6 (chronic load = 0 → ratio na not ∞), 9 (week with 1 run → longRunShare na)
- [ ] T021 [US2] Create `src/pages/Load.tsx`: KPI row (acuteChronicRatio, weeklyVolumeProgression hours + runKm, longRunShare, hardDayStreak, qualitySessionsThisWeek); acute:chronic 12-week daily line chart with bands shaded; 16-week stacked hours chart with recovery weeks marked and baseline line; run-km 16-week chart with +10% limit line; 14-day session table (date, sessions, load, quality/long flags); all charts use `AXIS_TICK`, `TOOLTIP`, `GRID` from `src/ui.tsx`
- [ ] T022 [US2] Add `/load` route to `src/App.tsx`; add "Load" nav item under Recovery section in `src/components/Nav.tsx`
- [ ] T023 [US2] **[PRE-SHIP GATE — human review]** Run the 8-week session validation: generate a table of activities from the last 8 weeks with columns `date, name, aerobic_te, anaerobic_te, duration_s, is_quality, is_long, is_hard_day`; review against memory; adjust thresholds in `src/lib/targets.ts` if needed; mark this task done only after SC-4 (≥ 90% match) is confirmed

**Checkpoint**: /load page fully functional; US-2 acceptance scenarios pass; npm test + tsc clean.

---

## Phase 5: US-3 — Consistency (Priority: P2)

**Goal**: "This Week" section on Overview with streak, active days, strength, intensity minutes; days-since per sport.

**Independent Test**: Overview "This Week" section renders with current-week values and all KPIs show correct status colours.

### Implementation for US-3

- [ ] T024 [US3] Add `daysSinceSport(activities: Activity[], today: Date): Record<"swim" | "bike" | "run" | "strength", KpiResult>` to `src/lib/kpis.ts` per spec §4.9; thresholds from `targets.ts`; na when no activity of that type exists
- [ ] T025 [US3] Add `weeklyTrainingStreak(weeks: WeekSummary[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.10: consecutive counting weeks (≥ `WEEKLY_COUNTING_SESSIONS` sessions from `targets.ts`) ending at last completed week; value = current streak; best streak in `rule` text
- [ ] T026 [US3] Add `activeDaysYtd(activities: Activity[], today: Date): { ytd: KpiResult; prevYtd: KpiResult; thisWeek: KpiResult }` to `src/lib/kpis.ts` per spec §4.11; active day = ≥ 1 training activity or hike on a local date; YTD vs same date previous year
- [ ] T027 [US3] Add `strengthMobilityThisWeek(weeks: WeekSummary[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.12; target `STRENGTH_SESSION_TARGET` from `targets.ts`; no status before Thursday (day 4 of week)
- [ ] T028 [US3] Add `intensityMinutesThisWeek(daily: Daily[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.13; Σ(`moderate_min` + 2 × `vigorous_min`) Monday → today; target 150; shown as progress only (no `act` status)
- [ ] T029 [US3] Add "This Week" section to `src/pages/Overview.tsx` per §5.1 wireframe below the Today card; render streak, quality sessions, strength sessions, active days, intensity minutes, days-since swim/bike/run/strength (now fully implemented via T024)

**Checkpoint**: "This Week" section renders correctly; days-since placeholder in Today card (T015) updated to use T024's real data.

---

## Phase 6: US-4 — Sleep Habits (Priority: P2)

**Goal**: Sleep page additions (rolling average line, bedtime scatter) and Recovery page additions (HRV chart with Garmin baseline band, RHR baseline line).

**Independent Test**: Sleep page renders 7-day rolling average line + bedtime/wake scatter; Recovery page renders HRV chart with baseline band shaded.

### Implementation for US-4

- [ ] T030 [US4] Add `sleepRolling7d(sleep: Sleep[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.14: 7-day rolling average of `total_sleep_s`; thresholds from `targets.ts`
- [ ] T031 [US4] Add `bedtimeConsistency(sleep: Sleep[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.14: convert `started_at` UTC to Europe/Paris local time; express as minutes from 18:00 (wraps past midnight); SD over last 14 nights; thresholds from `targets.ts`; include average bedtime and wake time in `rule`
- [ ] T032 [US4] Add HRV chart to `src/pages/Recovery.tsx`: nightly `last_night_avg` dots for 30 nights, Garmin baseline band (`baseline_low`→`baseline_high`) shaded as reference area, dot colour by `status`; use `AXIS_TICK`, `TOOLTIP`, `GRID`
- [ ] T033 [US4] Add 30-day baseline line to the existing RHR chart in `src/pages/Recovery.tsx` (computed from `rhrvBaseline`'s baseline value)
- [ ] T034 [US4] Add to `src/pages/SleepPage.tsx`: 7-day rolling average line overlaid on the existing sleep duration chart (with 7.5 h target line and 7 h flag line); bedtime/wake-time scatter chart (§4.14) for 30 nights with target sleep window; `bedtimeConsistency` KPI using the extended `Stat` component

**Checkpoint**: Sleep and Recovery pages render new elements; `npm test` passes bedtime-spread edge case (§6/8).

---

## Phase 7: US-5 — Weight Trend Safety (Priority: P3)

**Goal**: Daily weigh-in sync from Index S2 via Personal API; weight rate-of-change KPI on Health page.

**Independent Test**: Health page shows weight rate KPI with correct status (or "–" with reason when < 4 weigh-ins in 28 days).

### Implementation for US-5

- [ ] T035 [US5] **[PRE-CODING GATE — human action]** Hit the Personal API weight endpoint (token from existing `exchange_token()`); confirm whether values are kg or grams; update `parse_weigh_in` comment below before coding T036
- [ ] T036 [US5] Add `parse_weigh_in(w: dict)` to `etl/sync_personal_api.py` and call `/weight-service/weight/all/{start}/{end}`, filtering `sourceType == "INDEX_SCALE"`; apply unit conversion only if T035 confirms grams; upsert to `garmin_weigh_ins` on `measured_at`; follow the existing `parse_hrv` / `upsert` pattern
- [ ] T037 [US5] Add `weightRateOfChange(weighIns: WeighIn[], today: Date): KpiResult` to `src/lib/kpis.ts` per spec §4.16: linear regression slope of `weight_kg` over last 28 days (≥ 4 weigh-ins required); thresholds from `targets.ts`; loss rate is flagged, gains shown neutrally
- [ ] T038 [US5] Add weight rate KPI to `src/pages/Health.tsx` per §5.5 using extended `Stat` component

**Checkpoint**: Running `python etl/sync_personal_api.py --dry-run` shows weigh-in fetch in output; Health page renders weight rate KPI.

---

## Phase 8: FR-004 — Bucket Refactor (Do Last)

**Purpose**: Split `"weights"` → `"strength"` + `"mobility"`. Done last because it touches Nav, routes, and all existing pages.

**⚠️ WARNING**: This phase touches `src/lib/metrics.ts` and every page that references buckets. Do on its own branch if possible.

- [ ] T039 **[PRE-REFACTOR GATE — human action]** Run in Supabase SQL editor: `select activity_type, count(*) from garmin_activities group by 1 order by 2 desc`; list any types that do not appear in the current `TYPE_MAP` in `src/lib/metrics.ts`; add missing types to the mapping plan below before coding T040
- [ ] T040 Modify `src/lib/metrics.ts`: split `"weights"` into `"strength"` (strength_training, strength, fitness_equipment, training, hiit, indoor_cardio) and `"mobility"` (yoga, pilates, plus any new types from T039); update `Bucket` type, `BUCKET_META`, `ACTIVITY_BUCKETS`, `ALL_BUCKETS`; update `TYPE_MAP`
- [ ] T041 Update all callers of `ACTIVITY_BUCKETS`, `ALL_BUCKETS`, `BUCKET_META`, and `bucketOf()` in `src/pages/` (ActivityDetail, Bloods, BodyComp, Health, Overview, Recovery, SleepPage, StepsPage, TrainingPlan, Load) and `src/components/Nav.tsx` to use `"strength"` / `"mobility"` instead of `"weights"`
- [ ] T042 Add `"mobility"` route and nav item in `src/components/Nav.tsx` and `src/App.tsx` to match the `"strength"` handling introduced with this refactor

**Checkpoint**: `npx tsc --noEmit` clean; all pages compile; existing sport-card charts render correctly with the renamed buckets.

---

## Final Phase: Polish & Validation

- [ ] T043 [P] Update `CLAUDE.md`: add `src/lib/weeks.ts`, `src/lib/kpis.ts`, `src/lib/targets.ts` to the Architecture section; add `npm test` to Commands; note `src/lib/targets.ts` as the personalisation point for KPI thresholds
- [ ] T044 Run the full quickstart.md validation: `npx tsc --noEmit`, `npm test` (all green), spot-check SC-3 (3 random weeks vs Garmin Connect within 1%), verify `grep -r "GARMIN_SUPABASE_SECRET\|GARMIN_PERSONAL_API" dist/` returns no matches after `npm run build`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all KPI phases
- **Phases 3–6 (US-1 to US-4)**: All depend on Phase 2; can run sequentially P1 → P2
- **Phase 7 (US-5)**: Depends on Phase 2; T035 gate must clear before T036
- **Phase 8 (FR-004)**: Depends on Phase 2; T039 gate must clear before T040; do last
- **Final Phase**: Depends on all desired stories being complete

### User Story Dependencies

- **US-1 (P1)**: Can start after Phase 2; no dependency on other stories
- **US-2 (P1)**: Can start after Phase 2; T023 gate is human-review (do before shipping hard-day KPI)
- **US-3 (P2)**: Can start after Phase 2; T029 completes the Today card days-since placeholder from T015
- **US-4 (P2)**: Can start after Phase 2; T031 needs `Sleep.started_at` from T002
- **US-5 (P3)**: T035 gate blocks T036; T037 is independent of T036 (different file)
- **FR-004**: Independent; T039 gate blocks T040

### Parallel Opportunities Within Phase 2

T002, T003, T004, T005 can all run in parallel (four different files).
T006 depends on T002 (Activity type). T007 and T008 depend on T006.

### Parallel Opportunities Within Phase 3

T009–T012 are sequential (same file: kpis.ts).
T014 (ui.tsx) can run in parallel with T009–T012 (different file).
T015 (Overview.tsx) depends on T009–T014.

---

## Implementation Strategy

### MVP (US-1 Today card only)

1. Phase 1 → Phase 2 → Phase 3
2. Ship: Overview with Today card showing readiness verdict
3. Delivers SC-1 (verdict visible in < 5 s)

### Incremental Delivery

1. Phase 1 + 2 → Foundation
2. Phase 3 (US-1) → Today card — SC-1 ✓
3. Phase 4 (US-2) → Load page — SC-3 spot-check gate
4. Phase 5 (US-3) → This Week section
5. Phase 6 (US-4) → Sleep/Recovery additions
6. Phase 7 (US-5) → Weight trend (gated on endpoint test)
7. Phase 8 (FR-004) → Bucket refactor (own branch)

---

## Notes

- `[P]` = parallelisable with other [P] tasks in the same phase (different files)
- `[USN]` = maps to User Story N in spec.md for traceability
- Gate tasks (T023, T035, T039) require human action before the next task can proceed
- Run `npx tsc --noEmit && npm test` after each checkpoint before advancing
- Constitution compliance checklist per PR: I (no VITE_ secrets), II (no component-level fetches), III (npm test passes), IV (all charts use AXIS_TICK/TOOLTIP/GRID), V (all Hrv/Sleep rows typed), VI (reason set when value is null), VII (no toISOString() in date maths), VIII (all thresholds in targets.ts)
