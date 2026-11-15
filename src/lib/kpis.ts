// KPI functions — pure, no side-effects, no React imports.
// Constitution VI: `reason` MUST be set whenever `value === null` or `status === "na"`.
// Constitution VIII: all thresholds come from targets.ts, never inline.

import type { Daily, Hrv, Sleep } from "./data";
import { parseLocalDate } from "./metrics";
import {
  RHR_WATCH_BPM, RHR_ACT_BPM, RHR_BASELINE_MIN_DAYS,
  SLEEP_TARGET_S, SLEEP_WATCH_S, SLEEP_ACT_S,
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

// ---- §4.1 Resting HR vs baseline -------------------------------------------

export function rhrvBaseline(daily: Daily[], today: Date): KpiResult {
  const todayStr = localStr(today);
  const yesterdayStr = addDays(today, -1);

  // today's row first; fall back to yesterday (sync runs at 05:15 UTC, §6/11)
  let todayRow = daily.find((d) => d.summary_date === todayStr);
  let isYesterday = false;
  if (!todayRow) {
    todayRow = daily.find((d) => d.summary_date === yesterdayStr);
    isYesterday = true;
  }

  if (!todayRow || todayRow.resting_hr == null) {
    return { value: null, unit: "bpm", status: "na", rule: "No resting HR today", reason: "no daily row synced yet" };
  }

  // 30-day baseline: the 30 days before today (excluding today)
  const cutoff = addDays(today, -30);
  const baseline = daily
    .filter((d) => d.summary_date >= cutoff && d.summary_date < todayStr && d.resting_hr != null)
    .map((d) => d.resting_hr as number);

  if (baseline.length < RHR_BASELINE_MIN_DAYS) {
    return {
      value: todayRow.resting_hr,
      unit: "bpm",
      status: "na",
      rule: `${baseline.length} days of baseline data (need ≥ ${RHR_BASELINE_MIN_DAYS})`,
      reason: `only ${baseline.length} baseline days`,
    };
  }

  const avg = mean(baseline);
  const delta = todayRow.resting_hr - avg;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(0)}` : delta.toFixed(0);
  const avgRound = Math.round(avg);
  const label = isYesterday ? "yesterday's reading" : "today";
  const ruleBase = `RHR ${todayRow.resting_hr} bpm (${deltaStr} vs ${avgRound} bpm 30d avg)${isYesterday ? " — " + label : ""}`;

  if (delta >= RHR_ACT_BPM) {
    return { value: todayRow.resting_hr, unit: "bpm", status: "act", rule: `${ruleBase} — elevated; plan easy day` };
  }
  if (delta >= RHR_WATCH_BPM) {
    return { value: todayRow.resting_hr, unit: "bpm", status: "watch", rule: `${ruleBase} — slightly above baseline` };
  }
  return { value: todayRow.resting_hr, unit: "bpm", status: "ok", rule: ruleBase };
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

  if (hours >= SLEEP_TARGET_S / 3600) {
    return { value: hStr, unit: "h", target: `${targetH} h`, status: "ok", rule: `Sleep ${hStr} h — above target` };
  }

  if (hours >= SLEEP_WATCH_S / 3600) {
    return { value: hStr, unit: "h", target: `${targetH} h`, status: "watch", rule: `Sleep ${hStr} h — below 7.5 h target` };
  }

  // < 6 h: act only on second consecutive night
  const prevRow = sleep.find((s) => s.sleep_date === yesterdayStr);
  const prevShort = prevRow != null && prevRow.total_sleep_s != null && prevRow.total_sleep_s < SLEEP_ACT_S;

  if (prevShort) {
    return {
      value: hStr, unit: "h", target: `${targetH} h`,
      status: "act",
      rule: `Sleep ${hStr} h — under 6 h two nights running; prioritise rest`,
    };
  }
  return { value: hStr, unit: "h", target: `${targetH} h`, status: "watch", rule: `Sleep ${hStr} h — under 6 h tonight` };
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
