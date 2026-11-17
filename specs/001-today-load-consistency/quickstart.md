# Quickstart Validation Guide: Today, Load & Consistency

**Date**: 2026-11-15 | **Feature**: [spec.md](spec.md)

## Prerequisites

- Node 20+, Python 3.x
- `.env` populated (see `README.md`)
- Supabase populated with ≥ 21 days of daily summaries + HRV rows

## Quality gate (run before every PR)

```bash
npx tsc --noEmit   # must pass with 0 errors
npm test           # vitest run — all tests green
```

## Validate the unit tests (§6 edge cases)

```bash
npm test -- --reporter=verbose
```

Expected: all 13+ edge cases from spec §6 have a matching test, including:
- §6/12: Hike with aerobic_te 4.2 / anaerobic_te 0.8 → `quality: false, long: false`
- §6/13: 2 h easy run → `long: true`
- §6/4–5: Recovery-week rebound and low-base limit
- §6/8: Bedtime 23:40 / 00:20 → spread 40 min

## Validate the Today card (US-1)

1. `npm run dev` → open `http://localhost:5173`
2. Verify the Today card appears above the sport cards on Overview.
3. With real data synced: confirm the verdict (Go / Easy / Rest) is shown with
   the triggering rule(s) in plain text.
4. With a stale bundle (oldest `summary_date` > 1 day ago): confirm the card
   shows "No data since {date} — watch not synced or not worn" with no verdict.

## Validate the Load page (US-2)

1. Navigate to `/load`.
2. Acute:chronic ratio card: confirm the coloured band label matches the ratio
   value (< 0.8 grey, 0.8–1.3 green, etc.).
3. Weekly volume chart: confirm 16-week stacked bar chart renders with recovery
   weeks visually marked.
4. Spot-check SC-3: open Garmin Connect, compare one week's run km and cycling
   hours. Values should match within 1%.

## Validate the hard-day streak (§4.7, SC-4 gate)

Before shipping the hard-day KPI, generate the validation table:

```bash
# After implementing kpis.ts, run a one-off script or add a temporary
# debug route that prints: date, activity name, aerobic_te, anaerobic_te,
# duration_s, bucket, is_quality, is_long, is_hard_day
# for all activities in the last 8 weeks.
```

Review the output against memory. ≥ 90% of sessions should be classified as
expected (SC-4). If not, adjust thresholds in `src/lib/targets.ts` before
the KPI ships.

## Pre-coding gate: weight endpoint (FR-003)

Before writing the weigh-in ETL:

```bash
python etl/sync_personal_api.py --dry-run --days 1
# Check for weight endpoint call in output once FR-003 scaffold exists.
# Or hit the endpoint manually:
#   GET https://personal.connectapi.garmin.com/weight-service/weight/all/{today}/{today}
# Confirm: are values in kg (e.g., 72.5) or grams (e.g., 72500)?
```

## Pre-refactor gate: activity type mapping (FR-004)

Before splitting the `weights` bucket:

```bash
# In Supabase SQL editor or via psql:
select activity_type, count(*)
  from garmin_activities
 group by 1
 order by 2 desc;
```

Compare against the current `TYPE_MAP` in `src/lib/metrics.ts`. Flag any
`activity_type` values not present in `TYPE_MAP` — they currently map to `null`
and will be dropped from bucket aggregation.

## Verify no secrets in the client bundle

```bash
npm run build
grep -r "GARMIN_SUPABASE_SECRET\|GARMIN_PERSONAL_API\|GH_PASSWORD" dist/
# Must return no matches.
```
