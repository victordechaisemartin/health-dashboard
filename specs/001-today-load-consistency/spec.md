# Feature spec 001 — Today, Load & Consistency (Phases 0–1)

| | |
|---|---|
| **Repo** | `victordechaisemartin/health-dashboard` |
| **Status** | Draft — ready for `/speckit.clarify` → `/speckit.plan` |
| **Author** | Victor (with Claude, coach project) · 15 Nov 2026 |
| **Source of rules** | `coaching-method.md` (Garmin Coach project) — every threshold below comes from it unless marked *default* |
| **Out of scope** | Phase 2+ (year-over-year page, new Garmin endpoints, plan integration) — see §9 |

---

## 1. Why

The dashboard today answers *"what did I do?"* (volume per sport, per period). It does not answer the coaching questions that drive decisions:

- **Today:** am I recovered enough to train as planned?
- **Load:** am I ramping too fast? Am I stacking hard days? Is my long run too big?
- **Consistency:** am I training regularly, sleeping enough, doing strength, moving enough?

Everything in this spec is computable from data **already in Supabase** (plus HRV and weigh-ins, which are synced or syncable but not wired through). No new Garmin endpoint is required.

### Guiding principles (proposed constitution additions)

1. **Never invent a number.** Missing data shows `–` plus a one-line reason ("no HRV last night — watch not worn?"). No interpolation, no fake defaults.
2. **Every KPI shows value, target and status.** Status is one of `ok` (green), `watch` (amber), `act` (red), `n/a` (grey — not enough data). The tooltip states the rule in plain words.
3. **Thresholds live in one file** (`src/lib/targets.ts`) so they can be retuned without touching components.
4. **Local dates only.** All day/week maths use `parseLocalDate` / local fields (existing rule in `metrics.ts`). Weeks run **Monday 00:00 → Sunday 23:59 local**.
5. **"Today" means the real calendar date in Europe/Paris**, not `datasetNow()`. If data for today/last night is missing, say so — don't silently show yesterday as today.
6. **KPI maths is unit-tested.** Components stay thin; all logic sits in pure functions in `src/lib/`.

---

## 2. User stories & acceptance scenarios

### US-1 — Morning check (P1)
*As Victor, when I open the dashboard in the morning, I want one card that tells me whether to train as planned, go easy, or rest — and why.*

- **Given** last night's HRV, sleep and this morning's resting HR are synced, **when** I open Overview, **then** the Today card shows a verdict (Go / Easy / Rest), the three signals with their baselines, and the rule(s) that triggered the verdict.
- **Given** the newest daily/sleep row is older than yesterday, **when** I open Overview, **then** the card shows "No data since {date} — watch not synced or not worn" and no verdict.
- **Given** HRV status was LOW or UNBALANCED on each of the last 2 nights, **then** the verdict is at least **Easy**, with the reason "HRV unbalanced/low 2 nights in a row".

### US-2 — Load safety (P1)
*As Victor, I want to see whether my weekly load is ramping safely, using my coach's rules.*

- **Given** ≥ 21 days of activity history in the last 28 days, **when** I open Load, **then** I see the acute:chronic ratio with a coloured band (0.8–1.3 green, 1.3–1.5 amber, > 1.5 red, < 0.8 grey "detraining").
- **Given** last completed week's training hours rose > 10% over its baseline (§4.6), **then** the weekly-volume KPI is amber, and red if > 20%.
- **Given** my longest run of the week is > 30% of that week's run km and the week has ≥ 3 runs, **then** the long-run KPI is amber.
- **Given** I did two hard days back-to-back, **then** the hard-day streak KPI shows "2 in a row" in amber; 3+ in red.

### US-3 — Consistency (P2)
*As Victor, I want to see whether I'm consistent week after week.*

- Weekly training streak (current + best), active days YTD vs same date last year, strength sessions this week vs target, intensity minutes this week vs 150, days since last swim / bike / run.

### US-4 — Sleep habits (P2)
*As Victor, I want to know if I'm sleeping enough and regularly.*

- 7-day rolling sleep average vs 7.5 h target (flag < 7 h), last night vs target, bedtime/wake-time consistency over the last 14 nights.

### US-5 — Weight trend safety (P3)
*As Victor, I want weigh-ins to arrive automatically and to be warned if weight drops too fast.*

- Weigh-ins from the Index S2 sync daily; Health page shows the 4-week rate of change in kg/week with a warning beyond the threshold in §4.16.

---

## 3. Phase 0 — groundwork (functional requirements)

| ID | Requirement |
|---|---|
| **FR-001** | `garmin_hrv` is loaded into the bundle (`Bundle.hrv: Hrv[]`), optional like `dexa_scans` (`.catch(() => [])`), and counted in `lastRefreshed()`. |
| **FR-002** | `Sleep` type exposes `started_at` and `ended_at` (already in the table and filled by both loaders). |
| **FR-003** | The daily sync (`etl/sync_personal_api.py`) also pulls weigh-ins from `/weight-service/weight/all/{start}/{end}`, keeps only `sourceType = INDEX_SCALE`, applies the same field mapping as `parse_weigh_ins` in `load_export.py`, and upserts to `garmin_weigh_ins` on `measured_at`. The endpoint has not been tested yet. **Pre-coding task:** hit the endpoint once, check whether values are in grams (like the GDPR export) or already kg, and update the unit conversion accordingly before FR-003 ships. |
| **FR-004** | Activity buckets split `weights` into **`strength`** (strength_training, strength, fitness_equipment, training, hiit, indoor_cardio) and **`mobility`** (yoga, pilates, plus any other mobility type found). Mapping is accepted as proposed. **Pre-refactor task:** run `select activity_type, count(*) from garmin_activities group by 1 order by 2 desc` against the full Supabase history (not the 7-day API sample) and list any types that return `null` from the current `TYPE_MAP` before the bucket split lands. |
| **FR-005** | New module `src/lib/weeks.ts`: `weekStart(date)` (local Monday), `weeklySeries(activities, nWeeks, today)` returning, per week and per bucket: sessions, hours, km, load, longest session (duration and km), quality-session count (§4.7). Current week is flagged `inProgress: true`. |
| **FR-006** | New module `src/lib/targets.ts` holding every threshold in §4 as named constants with a comment citing the coaching rule. |
| **FR-007** | Add `vitest` (dev dependency) and `npm test`. Tests cover the edge cases in §6. |
| **FR-008** | New helper `today()` returning the real local date (Europe/Paris), and `dataFreshness(bundle)` returning the newest `summary_date`, `sleep_date` and `hrv_date`. |

---

## 4. KPI definitions (Phase 1)

"Training activities" = buckets running, cycling, swimming, strength, mobility. **Hiking** (walking bucket, `hiking` type) counts for load and active days but not for weekly training hours — see open question Q1.

### 4.1 Resting HR vs baseline
- **Value:** today's `garmin_daily_summary.resting_hr`.
- **Baseline:** mean of the previous 30 days (excluding today, ≥ 14 values required, else `n/a`). Also show the 7-day mean.
- **Status:** `ok` < +3 bpm · `watch` +3 to +4 · `act` ≥ +5 bpm vs 30-day baseline. *(defaults — not in coaching-method.md)*

### 4.2 HRV vs baseline
- **Value:** last night's `last_night_avg` from `garmin_hrv` (row dated today).
- **Baseline:** Garmin's own band `[baseline_low, baseline_high]`; status label from `status`.
- **Status:** `ok` BALANCED · `watch` one night LOW/UNBALANCED, or value below `baseline_low` · `act` LOW/UNBALANCED **2+ nights in a row** (coaching rule §5) · `n/a` NO_STATUS or missing.

### 4.3 Last night's sleep
- **Value:** `total_sleep_s` for `sleep_date = today` (Garmin dates sleep by wake-up day).
- **Target:** 7.5 h.
- **Status:** `ok` ≥ 7.5 h · `watch` 6–7.5 h · `act` < 6 h **two nights running** (coaching rule §5); a single night < 6 h is `watch`.
- Also show sleep score (Garmin's own; the derived proxy `sleepScoreOf` is labelled "est.").

### 4.4 Today verdict
Combine 4.1–4.3. Readiness is not available until Phase 3, so the card states "verdict without Garmin readiness".

| Verdict | Rule |
|---|---|
| **Rest / easy only** | HRV `act` **and** (sleep `act` or RHR `act`) |
| **Easy** | any single `act`, or ≥ 2 `watch` |
| **Go** | otherwise |
| **No verdict** | HRV *and* sleep missing for last night |

The card lists the triggering rule(s) in plain words, e.g. "HRV low 2 nights in a row · RHR +6 bpm vs 30-day".

### 4.5 Acute:chronic load ratio
- **Acute** = sum of `training_load` over the last 7 days (today included).
- **Chronic** = sum over the last 28 days ÷ 4.
- **Ratio** = acute ÷ chronic; `n/a` if chronic = 0 or fewer than 21 of the last 28 days are covered by synced daily rows.
- **Bands** (coaching rule §2): `< 0.8` grey "detraining", `0.8–1.3` ok, `1.3–1.5` watch, `> 1.5` act "reduce now".
- Label: "approximation — replaced by Garmin's own ratio in Phase 3". Chart: 12-week daily line with the bands shaded.

### 4.6 Weekly volume progression
- Unit: **training hours** (all training buckets) and, separately, **run km**.
- **Baseline** for week *W* = the highest of the previous 4 completed weeks (*W−4…W−1*). This stops the first week back after a recovery week from showing as a +40% spike, while a ramp after a real break (1, 1, 1, 1 → 3 h) still flags.
- **Increase %** = (W − baseline) ÷ baseline, on the **last completed week**. The current week shows "so far" with no status.
- **Limit:** +10%; +15% if baseline < 4 h (coaching rule §2). `ok` ≤ limit · `watch` ≤ 2× limit · `act` > 2× limit.
- Run km uses the same limit (coaching: grow run km more slowly than bike/swim — show it as its own KPI).
- **Volume + intensity in the same week:** if hours rose > limit **and** quality sessions rose vs the previous week → extra `watch` note "volume and intensity up together".
- Chart: last 16 weeks, stacked hours per sport, recovery weeks (≥ 30% below baseline) marked.

### 4.7 Hard days & quality sessions
- **Quality session** (*default*): `anaerobic_te ≥ 2.0`, **or** `aerobic_te ≥ 4.0` with duration < 90 min. Hikes (`hiking` type) are excluded from both quality and long classification unless `anaerobic_te ≥ 2.0`.
- **Long session:** duration ≥ 90 min (any training bucket, except hikes — same exclusion as above).
- **Hard day** = a local date with ≥ 1 quality or long session.
- **KPIs:** consecutive hard days ending today or yesterday (`ok` ≤ 1 · `watch` 2 · `act` ≥ 3) and quality sessions this week across all sports (`ok` ≤ 3 · `watch` 4 · `act` ≥ 5; coaching: max 2–3).
- **Pre-ship validation task:** generate a table of the last 8 weeks' sessions with their quality/long flag for review before the hard-day KPI ships (SC-4 acceptance gate).

### 4.8 Long-run share
- **Value:** longest run (km) ÷ total run km for the last completed week.
- **Status:** `ok` ≤ 30% · `watch` 30–40% · `act` > 40%; `n/a` if the week has < 3 runs (one run is 100% by definition).
- Note in the tooltip: coaching exception for ultra/trail blocks.

### 4.9 Days since last session, per sport
- For swim, bike, run and strength: days between `today()` and the latest `activity_date`.
- **Status** (*default*): swim/bike/run `watch` at ≥ 7 days, `act` at ≥ 14; strength `watch` ≥ 8 days.

### 4.10 Weekly training streak
- A week **counts** if it has ≥ 3 training sessions (*default*, in `targets.ts`).
- **Current streak** = consecutive counting weeks ending at the last completed week (the current week extends the streak once it counts). **Best streak** = all-time maximum, with its dates.

### 4.11 Active days
- An **active day** is a local date with ≥ 1 training activity or hike.
- Show YTD count vs the same date last year (same logic as `periods("year")`), plus this week (x/7).

### 4.12 Strength & mobility this week
- Strength sessions this week vs target **2** (base) — the phase isn't known before plan integration, so the target is a constant. Mobility count shown alongside, no target.
- Status: `ok` ≥ target · `watch` 1 · `act` 0 by Sunday (no status before Thursday).

### 4.13 Intensity minutes this week
- Σ (`moderate_min` + 2 × `vigorous_min`) from `garmin_daily_summary`, Monday → today. Target 150 (Garmin default).
- Shown as progress only; no `act` status (it's a health marker, not a training rule).

### 4.14 Sleep regularity
- **7-day rolling average** of `total_sleep_s`: `ok` ≥ 7.5 h · `watch` 7–7.5 h · `act` < 7 h (coaching §7: flag weeks below 7 h).
- **Bedtime consistency** over the last 14 nights: convert `started_at` (UTC) to local time, express it as minutes from 18:00 so it wraps cleanly past midnight, and take the standard deviation. `ok` ≤ 30 min · `watch` ≤ 60 · `act` > 60 (*default*). Show the average bedtime and wake time.
- Chart: bedtime/wake-time dots per night for 30 nights, with the target sleep window.

### 4.15 Steps
- Already on the Steps page. Add today's progress vs `step_goal` to the Today card (info only).

### 4.16 Weight rate of change
- Linear regression slope of `weight_kg` over the last 28 days (≥ 4 weigh-ins), in kg/week.
- `watch` if the loss is faster than 0.5 kg/week, `act` faster than 1.0 kg/week (*defaults*); gains shown neutrally.

---

## 5. Screens

### 5.1 Overview — new top section "Today" (above the existing sport cards)
```
┌ TODAY · Sun 15 Nov ──────────────────────────── Data as of 06:12 ┐
│  VERDICT: EASY        "HRV unbalanced 2 nights in a row"         │
│  HRV 58 ms (band 62–78) ⚠ · RHR 47 (+2 vs 30d) ✓ · Sleep 6h50 ⚠  │
│  Steps 3,120 / 12,000 · Days since: 🏊 9 ⚠  🚴 3  🏃 1  🏋️ 5       │
└──────────────────────────────────────────────────────────────────┘
┌ THIS WEEK (Mon–today) ───────────────────────────────────────────┐
│  Hours 4.2 so far · Quality 2/3 · Strength 1/2 · Intensity 180/150│
│  Streak 6 weeks (best 11) · Active days 4/7 · YTD 212 vs 198      │
└──────────────────────────────────────────────────────────────────┘
```
*(Illustrative layout — the numbers are not real data.)*

### 5.2 New page `/load` — "Training load" (nav section Recovery)
1. KPI row: acute:chronic ratio · last-week hours vs baseline · run km vs baseline · long-run share · hard-day streak · quality this week.
2. Chart: acute:chronic ratio, 12 weeks, bands shaded.
3. Chart: weekly hours stacked by sport, 16 weeks, recovery weeks marked, baseline line overlaid.
4. Chart: weekly run km with its +10% limit line.
5. Table: last 14 days — date, sessions, load, quality/long flags (so the hard-day rule can be checked by eye).

### 5.3 Recovery page — additions
- HRV chart: nightly value with Garmin baseline band shaded and status colour per dot.
- RHR chart: 30-day baseline line added.

### 5.4 Sleep page — additions
- 7-day rolling average line with the 7.5 h target and 7 h flag lines.
- Bedtime/wake scatter (§4.14) + consistency KPI.

### 5.5 Health page — addition
- Weight rate KPI (§4.16).

Every KPI uses the existing `Stat` component, extended with a `status` prop (`ok | watch | act | na`) and a `rule` tooltip. Charts use `AXIS_TICK`, `TOOLTIP` and `GRID` from `ui.tsx`.

---

## 6. Edge cases (must have tests)

1. Activity at 23:30 Sunday local → belongs to that week, not the next (UTC conversion trap).
2. DST weeks (29 Mar 2026, 25 Oct 2026): week boundaries and 7/28-day windows still count calendar days correctly.
3. Multisport day (tri): swim, bike and run legs count once each; parent and transitions excluded (already done by both loaders — test that `weeklySeries` doesn't re-add them).
4. Recovery-week rebound: weeks 5, 5, 5, 3, 5 h → the last week's increase is 0% vs baseline (5 h), not +67%. Weeks 5, 5, 5, 3, 6 h → +20% → `watch`.
5. Low base: baseline 3 h → 3.4 h is +13% → `ok` (15% limit).
6. Chronic load = 0 (back from a break) → ratio `n/a`, not ∞.
7. Gaps: watch not worn for 3 days → RHR baseline still works with ≥ 14 values; HRV "2 nights in a row" counts only consecutive dates.
8. Bedtimes 23:40 and 00:20 → spread 40 min, not 23 h.
9. Week with one 20 km run → long-run share `n/a` (fewer than 3 runs).
10. Indoor ride with 0 km → counts for hours and load, ignored for km and pace (existing rule in `aggregate`).
11. Today has no daily row yet (sync runs 05:15 UTC) → Today card shows yesterday's resting HR, labelled "yesterday".
12. A 3 h hike with `aerobic_te 4.2` and `anaerobic_te 0.8` → not quality, not long, not a hard day. Same hike with `anaerobic_te 2.1` → quality → hard day.
13. A 2 h easy run (`aerobic_te 3.8`, `anaerobic_te 0.5`) → long session → hard day (long-session rule still applies to non-hike activities regardless of TE).

---

## 7. Success criteria

- **SC-1** Opening the dashboard answers "train as planned / easy / rest?" in under 5 seconds, with the reason visible without clicking.
- **SC-2** Every KPI in §4 shows value, target, status and a rule tooltip, or `–` with a reason.
- **SC-3** Spot-check against Garmin Connect for 3 random weeks: weekly hours and km per sport match within 1%.
- **SC-4** The quality/long rule (§4.7) matches Victor's own judgement on ≥ 90% of the last 8 weeks' sessions.
- **SC-5** `npm test` and `npx tsc --noEmit` pass. No new secrets in the client bundle.

---

## 8. Open questions

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Do hikes count toward weekly training hours (they did in the Sep–Oct ramp)? | Count for load and active days, not for hours progression |
| Q2 | Training-session threshold for a "counting" week | 3 sessions |
| Q3 | Should the verdict also use subjective input (RPE, soreness) logged in the app? | No (Phase 5) |
| Q4 | RHR, bedtime, days-since and weight thresholds marked *default* | Keep the defaults, review after 4 weeks |
| Q5 | Weigh-in units from the Personal API (FR-003) | Deferred — endpoint not tested; run pre-coding check before FR-003 ships |

---

## 9. Out of scope (later phases)

- **Phase 2:** same month last year, last 12 months vs previous 12, Progression page, yearly KPI scorecard, aerobic efficiency trend.
- **Phase 3:** Garmin readiness, training status, load balance, VO2max, LT/FTP, endurance/hill score, race predictions, PRs, HR-zone time per activity, run dynamics, power.
- **Phase 4–5:** zone distribution, plan vs done, race readiness, interval execution.
- **Phase 6:** feeding computed KPIs into `/api/chat`.

---

## Clarifications

### Session 2026-11-15

- Q: Has the Personal API weight endpoint been tested and do values come in kg or grams? → A: Not tested yet — deferred. Pre-coding check required before FR-003 ships.
- Q: Do you accept the quality/long session defaults (`anaerobic_te ≥ 2.0` or `aerobic_te ≥ 4.0` < 90 min), and how should hikes be treated? → A: Accept defaults. Hikes excluded from quality/long unless `anaerobic_te ≥ 2.0`. Add pre-ship task to list last 8 weeks' sessions with flags for review.
- Q: Confirm the proposed strength/mobility split and verification approach for FR-004? → A: Keep proposed mapping. Verify against full Supabase history (not 7-day sample). Add pre-refactor task to list unmapped types.

---

## Appendix A — implementation notes for `/speckit.plan`

| Area | Files |
|---|---|
| Bundle + types | `api/_bundle.js` (add `garmin_hrv`), `src/lib/data.ts` (`Hrv` type, `Sleep.started_at/ended_at`, `Bundle.hrv`, `lastRefreshed`) |
| Buckets | `src/lib/metrics.ts` (`Bucket`, `BUCKET_META`, `TYPE_MAP`: `weights` → `strength` + `mobility`; update `ACTIVITY_BUCKETS`, Nav, routes) |
| New logic | `src/lib/weeks.ts`, `src/lib/kpis.ts` (one pure function per KPI returning `{ value, target, status, rule, reason? }`), `src/lib/targets.ts` |
| Tests | `src/lib/*.test.ts`, `vitest` in `devDependencies`, `"test": "vitest run"` |
| UI | `src/ui.tsx` (`Stat` + `status`/`rule`, new `StatusDot`), `src/pages/Overview.tsx` (Today + This week), new `src/pages/Load.tsx`, `Recovery.tsx`, `SleepPage.tsx`, `Health.tsx`, `src/components/Nav.tsx`, `src/App.tsx` (route `/load`) |
| ETL | `etl/sync_personal_api.py` (weigh-ins, FR-003) |
| Docs | `CLAUDE.md` (new modules, test command, targets file) |

Suggested order: FR-001/002/008 → FR-005/006/007 with tests → KPIs 4.1–4.4 (Today card) → 4.5–4.8 (Load page) → 4.9–4.13 (This week) → 4.14 (Sleep) → FR-003 + 4.16 → FR-004 (buckets touch many files; do it last or on its own branch).
