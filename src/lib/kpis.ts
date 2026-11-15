// KPI functions — pure, no side-effects, no React imports.
// Constitution VI: `reason` MUST be set whenever `value === null` or `status === "na"`.
// Constitution VIII: all thresholds come from targets.ts, never inline.

import type { Activity, Daily, Hrv, Sleep, WeighIn } from "./data";
import { parseLocalDate, bucketOf, sleepScoreOf } from "./metrics";
import { type WeekSummary, weekStart } from "./weeks";
import {
  RHR_WATCH_BPM, RHR_ACT_BPM, RHR_BASELINE_MIN_DAYS,
  SLEEP_TARGET_S, SLEEP_WATCH_S, SLEEP_ACT_S,
  ACWR_OK_MIN, ACWR_OK_MAX, ACWR_WATCH_MAX,
  WEEKLY_VOLUME_LIMIT_PCT, WEEKLY_VOLUME_LIMIT_LOW_BASE_PCT,
  HARD_DAY_STREAK_WATCH, HARD_DAY_STREAK_ACT,
  QUALITY_SESSIONS_TARGET,
  LONG_RUN_SHARE_WATCH, LONG_RUN_SHARE_ACT, LONG_RUN_MIN_RUNS,
  QUALITY_AEROBIC_TE, QUALITY_ANAEROBIC_TE, QUALITY_DURATION_MAX_S,
  LONG_DURATION_S,
  DAYS_SINCE_WATCH_ENDURANCE, DAYS_SINCE_ACT_ENDURANCE, DAYS_SINCE_WATCH_STRENGTH,
  WEEKLY_COUNTING_SESSIONS, STRENGTH_SESSION_TARGET, INTENSITY_MIN_TARGET,
  BEDTIME_WATCH_STD_MIN, BEDTIME_ACT_STD_MIN,
  WEIGHT_WATCH_LOSS_KG_WEEK, WEIGHT_ACT_LOSS_KG_WEEK, WEIGHT_MIN_WEIGH_INS,
} from "./targets";

export type KpiStatus = "ok" | "watch" | "act" | "na";

export type KpiResult = {
  value: number | string | null;
  unit?: string;
  target?: number | string;
  status: KpiStatus;
  rule: string;
  reason?: string;
};

// ---- local helpers ----------------------------------------------------------

/** "YYYY-MM-DD" from a Date using local fields — never toISOString(). */
function localStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" for d + n calendar days. */
function addDays(d: Date, n: number): string {
  return localStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

function mean(vals: number[]): number {
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function std(vals: number[]): number {
  const avg = mean(vals);
  return Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length);
}

/** Convert a UTC ISO timestamp to minutes-from-18:00 in Europe/Paris local time.
 *  Wraps past midnight so 23:30=330, 00:30=390 — prevents 23h false spread (§6/8). */
function toParisMinutes(isoUtc: string): number | null {
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const totalMin = h * 60 + m;
  return totalMin >= 18 * 60 ? totalMin - 18 * 60 : totalMin + 6 * 60;
}

/** Convert minutes-from-18:00 back to "HH:MM" display string. */
function minFromEighteenToHHMM(m: number): string {
  const totalMin = Math.round(m + 18 * 60) % (24 * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ---- §4.1 Resting HR vs baseline -------------------------------------------

export function rhrvBaseline(daily: Daily[], today: Date): KpiResult {
  const todayStr = localStr(today);
  const yesterdayStr = addDays(today, -1);

  // Prefer today's row with a valid HR; fall back to yesterday if today is
  // missing or has null resting_hr (sync runs at 05:15 UTC — §6/11).
  const todayRow = daily.find((d) => d.summary_date === todayStr && d.resting_hr != null);
  const yestRow = daily.find((d) => d.summary_date === yesterdayStr && d.resting_hr != null);
  const readingRow = todayRow ?? yestRow;
  const isYesterday = !todayRow && yestRow != null;

  if (!readingRow) {
    return { value: null, unit: "bpm", status: "na", rule: "No resting HR today", reason: "no daily row synced yet" };
  }

  // 30-day baseline: days strictly before the reading date (excludes the reading itself)
  const readingStr = readingRow.summary_date;
  const cutoff = addDays(today, -30);
  const baseline = daily
    .filter((d) => d.summary_date >= cutoff && d.summary_date < readingStr && d.resting_hr != null)
    .map((d) => d.resting_hr as number);

  // guaranteed non-null: readingRow was selected requiring resting_hr != null
  const rhr = readingRow.resting_hr!;

  if (baseline.length < RHR_BASELINE_MIN_DAYS) {
    return {
      value: rhr,
      unit: "bpm",
      status: "na",
      rule: `${baseline.length} days of baseline data (need ≥ ${RHR_BASELINE_MIN_DAYS})`,
      reason: `only ${baseline.length} baseline days`,
    };
  }

  const avg = mean(baseline);
  const delta = rhr - avg;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(0)}` : delta.toFixed(0);
  const avgRound = Math.round(avg);
  const label = isYesterday ? "yesterday's reading" : "today";
  const ruleBase = `RHR ${rhr} bpm (${deltaStr} vs ${avgRound} bpm 30d avg)${isYesterday ? " — " + label : ""}`;

  if (delta >= RHR_ACT_BPM) {
    return { value: rhr, unit: "bpm", status: "act", rule: `${ruleBase} — elevated; plan easy day` };
  }
  if (delta >= RHR_WATCH_BPM) {
    return { value: rhr, unit: "bpm", status: "watch", rule: `${ruleBase} — slightly above baseline` };
  }
  return { value: rhr, unit: "bpm", status: "ok", rule: ruleBase };
}

// ---- §4.2 HRV vs Garmin baseline -------------------------------------------

const BAD_HRV_STATUS = new Set(["LOW", "UNBALANCED"]);

export function hrvStatus(hrv: Hrv[], today: Date): KpiResult {
  const todayStr = localStr(today);
  const yesterdayStr = addDays(today, -1);

  const todayRow = hrv.find((h) => h.hrv_date === todayStr);
  if (!todayRow) {
    return { value: null, unit: "ms", status: "na", rule: "No HRV data for last night", reason: "watch not worn or not synced" };
  }
  if (todayRow.status === "NO_STATUS" || todayRow.last_night_avg == null) {
    return { value: null, unit: "ms", status: "na", rule: "HRV status unavailable", reason: "insufficient sleep data" };
  }

  const val = todayRow.last_night_avg;
  const band =
    todayRow.baseline_low != null && todayRow.baseline_high != null
      ? ` (band ${todayRow.baseline_low}–${todayRow.baseline_high})`
      : "";
  const statusLabel = todayRow.status ?? "unknown";

  // Consecutive-night logic: compare today and yesterday (only consecutive dates count — §6/7)
  const yesterdayRow = hrv.find((h) => h.hrv_date === yesterdayStr);
  const todayBad = BAD_HRV_STATUS.has(todayRow.status ?? "");
  const prevBad = yesterdayRow ? BAD_HRV_STATUS.has(yesterdayRow.status ?? "") : false;

  if (todayBad && prevBad) {
    return {
      value: val, unit: "ms",
      status: "act",
      rule: `HRV ${val} ms${band} — ${statusLabel} 2 nights in a row; plan easy/rest`,
    };
  }

  // Also watch if value is below baseline_low even when status is not LOW
  const belowBand = todayRow.baseline_low != null && val < todayRow.baseline_low;
  if (todayBad || belowBand) {
    return {
      value: val, unit: "ms",
      status: "watch",
      rule: `HRV ${val} ms${band} — ${statusLabel}; monitor recovery`,
    };
  }

  return {
    value: val, unit: "ms",
    status: "ok",
    rule: `HRV ${val} ms${band} — ${statusLabel}`,
  };
}

// ---- §4.3 Last night's sleep ------------------------------------------------

export function sleepLast(sleep: Sleep[], today: Date): KpiResult {
  const todayStr = localStr(today);
  const yesterdayStr = addDays(today, -1);

  const todayRow = sleep.find((s) => s.sleep_date === todayStr);
  if (!todayRow || todayRow.total_sleep_s == null) {
    return { value: null, unit: "h", status: "na", rule: "No sleep data for last night", reason: "watch not worn or not synced" };
  }

  const hours = todayRow.total_sleep_s / 3600;
  const hStr = hours.toFixed(1);
  const targetH = (SLEEP_TARGET_S / 3600).toFixed(1);

  // Build unit string: "h · 76" (Garmin score) or "h · 76 est." (derived proxy)
  const scoreVal = sleepScoreOf(todayRow);
  const isEst = scoreVal != null && (todayRow.sleep_score == null || todayRow.sleep_score <= 0);
  const unitStr = scoreVal != null ? `h · ${scoreVal}${isEst ? " est." : ""}` : "h";

  if (hours >= SLEEP_TARGET_S / 3600) {
    return { value: hStr, unit: unitStr, target: `${targetH} h`, status: "ok", rule: `Sleep ${hStr} h — above target` };
  }

  if (hours >= SLEEP_WATCH_S / 3600) {
    return { value: hStr, unit: unitStr, target: `${targetH} h`, status: "watch", rule: `Sleep ${hStr} h — below 7.5 h target` };
  }

  // < 6 h: act only on second consecutive night
  const prevRow = sleep.find((s) => s.sleep_date === yesterdayStr);
  const prevShort = prevRow != null && prevRow.total_sleep_s != null && prevRow.total_sleep_s < SLEEP_ACT_S;

  if (prevShort) {
    return {
      value: hStr, unit: unitStr, target: `${targetH} h`,
      status: "act",
      rule: `Sleep ${hStr} h — under 6 h two nights running; prioritise rest`,
    };
  }
  return { value: hStr, unit: unitStr, target: `${targetH} h`, status: "watch", rule: `Sleep ${hStr} h — under 6 h last night` };
}

// ---- §4.4 Today verdict -----------------------------------------------------

export function todayVerdict(rhr: KpiResult, hrv: KpiResult, sleep: KpiResult): KpiResult {
  const hrvMissing = hrv.status === "na";
  const sleepMissing = sleep.status === "na";

  if (hrvMissing && sleepMissing) {
    return { value: null, status: "na", rule: "No verdict", reason: "HRV and sleep missing for last night" };
  }

  const triggers: string[] = [];
  if (hrv.status === "act") triggers.push(hrv.rule);
  if (sleep.status === "act") triggers.push(sleep.rule);
  if (rhr.status === "act") triggers.push(rhr.rule);

  const watchCount = [rhr, hrv, sleep].filter((k) => k.status === "watch").length;

  // Rest / easy only: HRV act AND (sleep act OR RHR act)
  if (hrv.status === "act" && (sleep.status === "act" || rhr.status === "act")) {
    return { value: "Rest / easy only", status: "act", rule: triggers.join(" · ") };
  }

  // Easy: any single act, or ≥ 2 watch
  if (triggers.length > 0 || watchCount >= 2) {
    const watchTriggers = [rhr, hrv, sleep].filter((k) => k.status === "watch").map((k) => k.rule);
    const allTriggers = [...triggers, ...watchTriggers];
    return { value: "Easy", status: "watch", rule: allTriggers.join(" · ") };
  }

  return { value: "Go", status: "ok", rule: "All signals in range" };
}

// ---- §4.5 Acute:chronic load ratio -----------------------------------------

export function acuteChronicRatio(activities: Activity[], daily: Daily[], today: Date): KpiResult {
  const todayStr = localStr(today);
  const cutoff28 = addDays(today, -27);

  // Coverage: need ≥ 21 of last 28 days in daily summaries
  const covered = daily.filter((d) => d.summary_date >= cutoff28 && d.summary_date <= todayStr).length;
  if (covered < 21) {
    return {
      value: null, status: "na",
      rule: `Only ${covered}/28 days synced — need ≥ 21`,
      reason: `${covered}/28 days covered`,
    };
  }

  const acuteCutoff = addDays(today, -6);
  const acute = activities
    .filter((a) => a.activity_date >= acuteCutoff && a.activity_date <= todayStr)
    .reduce((s, a) => s + (a.training_load ?? 0), 0);
  const chronic = activities
    .filter((a) => a.activity_date >= cutoff28 && a.activity_date <= todayStr)
    .reduce((s, a) => s + (a.training_load ?? 0), 0) / 4;

  if (chronic === 0) {
    return { value: null, status: "na", rule: "Chronic load is zero (no training in last 28 days)", reason: "no load data" };
  }

  const ratio = +(acute / chronic).toFixed(1);
  const note = " Approximation — Garmin's own ratio in Phase 3.";

  if (ratio > ACWR_WATCH_MAX) {
    return { value: ratio, status: "act", rule: `ACWR ${ratio} — reduce now (> ${ACWR_WATCH_MAX}).${note}` };
  }
  if (ratio > ACWR_OK_MAX) {
    return { value: ratio, status: "watch", rule: `ACWR ${ratio} — elevated injury risk (${ACWR_OK_MAX}–${ACWR_WATCH_MAX}).${note}` };
  }
  // < 0.8 is detraining (grey) — show value as ok; rule notes the zone
  if (ratio < ACWR_OK_MIN) {
    return { value: ratio, status: "ok", rule: `ACWR ${ratio} — detraining zone (< ${ACWR_OK_MIN}).${note}` };
  }
  return { value: ratio, status: "ok", rule: `ACWR ${ratio} — optimal zone (${ACWR_OK_MIN}–${ACWR_OK_MAX}).${note}` };
}

// ---- §4.6 Weekly volume progression ----------------------------------------

export function weeklyVolumeProgression(
  weeks: WeekSummary[],
  today: Date,
): { hours: KpiResult; runKm: KpiResult } {
  const completed = weeks.filter((w) => !w.inProgress);
  if (completed.length === 0) {
    const r: KpiResult = { value: null, status: "na", rule: "No completed weeks", reason: "not enough history" };
    return { hours: r, runKm: r };
  }

  const lastIdx = completed.length - 1;
  const last = completed[lastIdx];
  const prior4 = completed.slice(Math.max(0, lastIdx - 4), lastIdx);

  if (prior4.length === 0) {
    const r: KpiResult = { value: null, status: "na", rule: "No prior weeks for baseline", reason: "need ≥ 1 prior week" };
    return { hours: r, runKm: r };
  }

  const baseHours = Math.max(...prior4.map((w) => w.totalHours));
  const baseKm = Math.max(...prior4.map((w) => w.byBucket.running.km));

  // Volume + intensity check: quality sessions rose and hours exceeded limit
  const prevCompleted = prior4[prior4.length - 1];
  const qualityRose =
    prevCompleted != null &&
    Object.values(last.byBucket).reduce((s, b) => s + b.qualitySessions, 0) >
      Object.values(prevCompleted.byBucket).reduce((s, b) => s + b.qualitySessions, 0);

  function volumeKpi(value: number, baseline: number, unit: "h" | "km"): KpiResult {
    if (baseline === 0) {
      return { value: +value.toFixed(1), unit, status: "ok", rule: `${value.toFixed(1)} ${unit} (no baseline)` };
    }
    const pct = (value - baseline) / baseline;
    const limit = baseline < 4 ? WEEKLY_VOLUME_LIMIT_LOW_BASE_PCT / 100 : WEEKLY_VOLUME_LIMIT_PCT / 100;
    const pctStr = `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(0)}%`;
    const baseStr = `${baseline.toFixed(1)} ${unit} baseline`;
    const intensityNote = qualityRose && pct > limit ? " · volume and intensity up together" : "";

    if (pct > 2 * limit) {
      return { value: +value.toFixed(1), unit, status: "act", rule: `${pctStr} vs ${baseStr}${intensityNote}` };
    }
    if (pct > limit) {
      return { value: +value.toFixed(1), unit, status: "watch", rule: `${pctStr} vs ${baseStr}${intensityNote}` };
    }
    return { value: +value.toFixed(1), unit, status: "ok", rule: `${pctStr} vs ${baseStr}` };
  }

  return {
    hours: volumeKpi(last.totalHours, baseHours, "h"),
    runKm: volumeKpi(last.byBucket.running.km, baseKm, "km"),
  };
}

// ---- §4.7 Hard-day streak ---------------------------------------------------

function isHardActivity(a: Activity): boolean {
  const bucket = bucketOf(a.activity_type);
  if (!bucket || bucket === "sleep") return false;
  const isHike = a.activity_type === "hiking";
  const anaerobic = a.anaerobic_te ?? 0;
  const aerobic = a.aerobic_te ?? 0;
  const dur = a.duration_s ?? 0;
  const quality = isHike
    ? anaerobic >= QUALITY_ANAEROBIC_TE
    : anaerobic >= QUALITY_ANAEROBIC_TE || (aerobic >= QUALITY_AEROBIC_TE && dur < QUALITY_DURATION_MAX_S);
  const long = !isHike && ["running", "swimming", "cycling"].includes(bucket) && dur >= LONG_DURATION_S;
  return quality || long;
}

export function hardDayStreak(activities: Activity[], today: Date): KpiResult {
  const todayStr = localStr(today);
  const cutoff = addDays(today, -20);

  const hardDates = new Set<string>();
  for (const a of activities) {
    if (a.activity_date < cutoff || a.activity_date > todayStr) continue;
    if (isHardActivity(a)) hardDates.add(a.activity_date);
  }

  const countBack = (startStr: string): number => {
    let n = 0;
    let d = parseLocalDate(startStr);
    while (hardDates.has(localStr(d))) {
      n++;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    }
    return n;
  };

  const todayStreak = countBack(todayStr);
  // If today is a rest day, check if yesterday ended a streak
  const yesterdayStr = addDays(today, -1);
  const streak = todayStreak > 0 ? todayStreak : countBack(yesterdayStr);

  if (streak === 0) return { value: 0, status: "ok", rule: "No hard days in a row" };
  if (streak >= HARD_DAY_STREAK_ACT) {
    return { value: streak, status: "act", rule: `${streak} hard days in a row — take an easy/rest day` };
  }
  if (streak >= HARD_DAY_STREAK_WATCH) {
    return { value: streak, status: "watch", rule: `${streak} hard days in a row — monitor recovery` };
  }
  return { value: streak, status: "ok", rule: `${streak} hard day in a row` };
}

export function qualitySessionsThisWeek(weeks: WeekSummary[], today: Date): KpiResult {
  const current = weeks.find((w) => w.inProgress);
  if (!current) {
    return { value: null, status: "na", rule: "No current week data", reason: "no activities this week" };
  }
  const total = Object.values(current.byBucket).reduce((s, b) => s + b.qualitySessions, 0);
  const target = QUALITY_SESSIONS_TARGET;

  if (total >= target + 2) {
    return { value: total, status: "act", rule: `${total} quality sessions this week — reduce intensity (target ≤ ${target})` };
  }
  if (total >= target + 1) {
    return { value: total, status: "watch", rule: `${total} quality sessions this week (target ≤ ${target})` };
  }
  return { value: total, status: "ok", rule: `${total}/${target} quality sessions this week` };
}

// ---- §4.8 Long-run share ---------------------------------------------------

export function longRunShare(weeks: WeekSummary[], today: Date): KpiResult {
  const completed = weeks.filter((w) => !w.inProgress);
  if (!completed.length) {
    return { value: null, status: "na", rule: "No completed weeks", reason: "not enough history" };
  }
  const last = completed[completed.length - 1];
  const run = last.byBucket.running;

  if (run.sessions < LONG_RUN_MIN_RUNS) {
    return {
      value: null, status: "na",
      rule: `${run.sessions} run(s) last week — need ≥ ${LONG_RUN_MIN_RUNS} for this KPI`,
      reason: `only ${run.sessions} run(s)`,
    };
  }
  if (run.km === 0) {
    return { value: null, status: "na", rule: "No run km last week", reason: "no km data" };
  }

  const share = run.longestKm / run.km;
  const pct = Math.round(share * 100);
  const note = " Coaching exception for ultra/trail blocks.";

  if (share > LONG_RUN_SHARE_ACT) {
    return { value: `${pct}%`, status: "act", rule: `Longest run is ${pct}% of weekly km — consider reducing.${note}` };
  }
  if (share > LONG_RUN_SHARE_WATCH) {
    return { value: `${pct}%`, status: "watch", rule: `Longest run is ${pct}% of weekly km.${note}` };
  }
  return { value: `${pct}%`, status: "ok", rule: `Longest run is ${pct}% of weekly km` };
}

// ---- §4.9 Days since last session -------------------------------------------

const SPORT_BUCKET = { swim: "swimming", bike: "cycling", run: "running", strength: "weights" } as const;

export function daysSinceSport(
  activities: Activity[],
  today: Date,
): Record<"swim" | "bike" | "run" | "strength", KpiResult> {
  const todayStr = localStr(today);
  const result = {} as Record<"swim" | "bike" | "run" | "strength", KpiResult>;

  for (const sport of ["swim", "bike", "run", "strength"] as const) {
    const bucket = SPORT_BUCKET[sport];
    const latestDate = activities
      .filter((a) => bucketOf(a.activity_type) === bucket && a.activity_date <= todayStr)
      .map((a) => a.activity_date)
      .sort()
      .slice(-1)[0];

    if (!latestDate) {
      result[sport] = { value: null, status: "na", rule: `No ${sport} logged`, reason: "no activity of this type" };
      continue;
    }

    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.round((parseLocalDate(todayStr).getTime() - parseLocalDate(latestDate).getTime()) / msPerDay);
    const watchAt = sport === "strength" ? DAYS_SINCE_WATCH_STRENGTH : DAYS_SINCE_WATCH_ENDURANCE;

    if (sport !== "strength" && days >= DAYS_SINCE_ACT_ENDURANCE) {
      result[sport] = { value: days, unit: "d", status: "act", rule: `${days}d since last ${sport} — time to train` };
    } else if (days >= watchAt) {
      result[sport] = { value: days, unit: "d", status: "watch", rule: `${days}d since last ${sport}` };
    } else {
      result[sport] = { value: days, unit: "d", status: "ok", rule: `${days}d since last ${sport}` };
    }
  }

  return result;
}

// ---- §4.10 Weekly training streak -------------------------------------------

const STREAK_BUCKETS = ["cycling", "running", "swimming", "weights"] as const;

function weekSessionCount(w: WeekSummary): number {
  return STREAK_BUCKETS.reduce((s, b) => s + w.byBucket[b].sessions, 0);
}

export function weeklyTrainingStreak(weeks: WeekSummary[], _today: Date): KpiResult {
  const completed = weeks.filter((w) => !w.inProgress);
  const current = weeks.find((w) => w.inProgress);

  // Walk backwards from last completed week counting consecutive counting weeks
  let streak = 0;
  for (let i = completed.length - 1; i >= 0; i--) {
    if (weekSessionCount(completed[i]) >= WEEKLY_COUNTING_SESSIONS) streak++;
    else break;
  }
  // Current week extends streak once it qualifies
  if (current && weekSessionCount(current) >= WEEKLY_COUNTING_SESSIONS) streak++;

  // Best streak in the whole series
  let best = 0;
  let run = 0;
  for (const w of [...completed, ...(current ? [current] : [])]) {
    if (weekSessionCount(w) >= WEEKLY_COUNTING_SESSIONS) { run++; best = Math.max(best, run); }
    else run = 0;
  }

  const unit = streak === 1 ? "week" : "weeks";
  return { value: streak, unit, status: "ok", rule: `${streak} week streak · best ${best}` };
}

// ---- §4.11 Active days ------------------------------------------------------

export function activeDaysYtd(
  activities: Activity[],
  today: Date,
): { ytd: KpiResult; prevYtd: KpiResult; thisWeek: KpiResult } {
  const todayStr = localStr(today);
  const y = today.getFullYear();
  const yearStart = `${y}-01-01`;
  const prevYearStart = `${y - 1}-01-01`;
  const prevYearToday = `${y - 1}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const weekStartStr = localStr(weekStart(today));

  function countActiveDays(from: string, to: string): number {
    const dates = new Set<string>();
    for (const a of activities) {
      if (a.activity_date >= from && a.activity_date <= to) dates.add(a.activity_date);
    }
    return dates.size;
  }

  const ytdDays = countActiveDays(yearStart, todayStr);
  const prevYtdDays = countActiveDays(prevYearStart, prevYearToday);
  const weekDays = countActiveDays(weekStartStr, todayStr);

  const ytd: KpiResult = {
    value: ytdDays,
    status: "ok",
    rule: prevYtdDays > 0 ? `${ytdDays} active days YTD vs ${prevYtdDays} last year` : `${ytdDays} active days YTD`,
  };
  const prevYtd: KpiResult = prevYtdDays > 0
    ? { value: prevYtdDays, status: "ok", rule: `${prevYtdDays} active days same period last year` }
    : { value: null, status: "na", rule: "No data for last year", reason: "no last-year data" };
  const thisWeek: KpiResult = {
    value: weekDays,
    unit: "/7",
    status: "ok",
    rule: `${weekDays}/7 active days this week`,
  };

  return { ytd, prevYtd, thisWeek };
}

// ---- §4.12 Strength & mobility this week ------------------------------------

export function strengthMobilityThisWeek(weeks: WeekSummary[], today: Date): KpiResult {
  const current = weeks.find((w) => w.inProgress);
  const sessions = current ? current.byBucket.weights.sessions : 0;
  const target = STRENGTH_SESSION_TARGET;
  const rule = `${sessions}/${target} strength sessions this week`;

  // No act/watch status before Thursday (Mon=1, Tue=2, Wed=3 → too early; Thu=4+, Sun=0 → apply)
  const dow = today.getDay();
  const tooEarly = dow >= 1 && dow <= 3;
  if (tooEarly || sessions >= target) return { value: sessions, status: "ok", rule };
  if (sessions === 1) return { value: sessions, status: "watch", rule };
  return { value: sessions, status: "act", rule };
}

// ---- §4.13 Intensity minutes this week --------------------------------------

export function intensityMinutesThisWeek(daily: Daily[], today: Date): KpiResult {
  const weekStartStr = localStr(weekStart(today));
  const todayStr = localStr(today);

  const totalMin = daily
    .filter((d) => d.summary_date >= weekStartStr && d.summary_date <= todayStr)
    .reduce((s, d) => s + (d.moderate_min ?? 0) + 2 * (d.vigorous_min ?? 0), 0);

  const target = INTENSITY_MIN_TARGET;
  return {
    value: totalMin,
    unit: "min",
    target: `${target} min`,
    status: totalMin >= target ? "ok" : "watch",
    rule: `${totalMin}/${target} intensity min this week`,
  };
}

// ---- §4.14 Sleep rolling average --------------------------------------------

export function sleepRolling7d(sleep: Sleep[], today: Date): KpiResult {
  const todayStr = localStr(today);
  const last7 = sleep
    .filter((s) => s.sleep_date <= todayStr && s.total_sleep_s != null)
    .sort((a, b) => a.sleep_date.localeCompare(b.sleep_date))
    .slice(-7);

  if (last7.length < 3) {
    return { value: null, status: "na", rule: "< 3 nights in last 7", reason: "not enough data" };
  }

  const avgS = last7.reduce((s, r) => s + r.total_sleep_s!, 0) / last7.length;
  const hours = +(avgS / 3600).toFixed(1);
  const targetH = (SLEEP_TARGET_S / 3600).toFixed(1);

  if (avgS >= SLEEP_TARGET_S) {
    return { value: hours, unit: "h", target: `${targetH} h`, status: "ok", rule: `7d avg ${hours} h — on target` };
  }
  if (avgS >= SLEEP_WATCH_S) {
    return { value: hours, unit: "h", target: `${targetH} h`, status: "watch", rule: `7d avg ${hours} h — below 7.5 h target` };
  }
  return { value: hours, unit: "h", target: `${targetH} h`, status: "act", rule: `7d avg ${hours} h — consistently under 7 h` };
}

// ---- §4.14 Bedtime consistency ----------------------------------------------

export function bedtimeConsistency(sleep: Sleep[], today: Date): KpiResult {
  const todayStr = localStr(today);
  const cutoff = addDays(today, -13); // last 14 nights inclusive

  const rows = sleep
    .filter((s) => s.sleep_date >= cutoff && s.sleep_date <= todayStr && s.started_at != null)
    .sort((a, b) => a.sleep_date.localeCompare(b.sleep_date));

  const bedMins = rows
    .map((s) => toParisMinutes(s.started_at!))
    .filter((v): v is number => v != null);

  if (bedMins.length < 3) {
    return { value: null, status: "na", rule: "< 3 nights with bedtime data in last 14 days", reason: "no started_at data" };
  }

  const sdMin = std(bedMins);
  const avgBed = mean(bedMins);
  const bedLabel = minFromEighteenToHHMM(avgBed);

  const wakeRows = rows.filter((s) => s.ended_at != null);
  const wakeMins = wakeRows.map((s) => toParisMinutes(s.ended_at!)).filter((v): v is number => v != null);
  const wakeLabel = wakeMins.length >= 3 ? minFromEighteenToHHMM(mean(wakeMins)) : null;

  const sdRound = Math.round(sdMin);
  const timesStr = wakeLabel ? `avg ${bedLabel} → ${wakeLabel}` : `avg ${bedLabel}`;
  const rule = `Bedtime SD ${sdRound} min · ${timesStr}`;

  if (sdMin > BEDTIME_ACT_STD_MIN) {
    return { value: sdRound, unit: "min SD", status: "act", rule: `${rule} — irregular bedtime` };
  }
  if (sdMin > BEDTIME_WATCH_STD_MIN) {
    return { value: sdRound, unit: "min SD", status: "watch", rule };
  }
  return { value: sdRound, unit: "min SD", status: "ok", rule };
}

// ---- §4.16 Weight rate of change --------------------------------------------

export function weightRateOfChange(weighIns: WeighIn[], today: Date): KpiResult {
  const todayStr = localStr(today);
  const cutoff = addDays(today, -27); // last 28 days inclusive

  const recent = weighIns
    .filter((w) => w.measured_date >= cutoff && w.measured_date <= todayStr)
    .sort((a, b) => a.measured_date.localeCompare(b.measured_date));

  if (recent.length < WEIGHT_MIN_WEIGH_INS) {
    return {
      value: null, status: "na",
      rule: `${recent.length}/${WEIGHT_MIN_WEIGH_INS} weigh-ins in last 28 days`,
      reason: `need ≥ ${WEIGHT_MIN_WEIGH_INS} weigh-ins`,
    };
  }

  // Linear regression slope (kg/day) → convert to kg/week
  const msPerDay = 24 * 60 * 60 * 1000;
  const origin = parseLocalDate(recent[0].measured_date).getTime();
  const xs = recent.map((w) => (parseLocalDate(w.measured_date).getTime() - origin) / msPerDay);
  const ys = recent.map((w) => w.weight_kg);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;

  if (denom === 0) {
    return { value: null, status: "na", rule: "All weigh-ins on the same date", reason: "no date spread" };
  }

  const slopePerWeek = +((n * sumXY - sumX * sumY) / denom * 7).toFixed(2);
  const loss = -slopePerWeek; // positive = losing, negative = gaining
  const absRate = Math.abs(slopePerWeek);
  const dirStr = slopePerWeek < -0.005 ? `+${absRate} kg/wk` : slopePerWeek > 0.005 ? `−${absRate} kg/wk` : "stable";
  const nStr = `${n} weigh-ins · ${dirStr}`;

  if (loss > WEIGHT_ACT_LOSS_KG_WEEK) {
    return { value: slopePerWeek, unit: "kg/wk", status: "act", rule: `${nStr} — loss too fast; risk muscle loss` };
  }
  if (loss > WEIGHT_WATCH_LOSS_KG_WEEK) {
    return { value: slopePerWeek, unit: "kg/wk", status: "watch", rule: `${nStr} — monitor closely` };
  }
  // Gains are shown neutrally
  return { value: slopePerWeek, unit: "kg/wk", status: "ok", rule: nStr };
}
