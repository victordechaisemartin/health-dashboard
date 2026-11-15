// KPI thresholds. Every constant cites its source: spec §N or "default".
// Change values here only — never inline magic numbers in kpis.ts.

// ---- Acute:Chronic Work Ratio (spec §4.5) -----------------------------------
export const ACWR_OK_MIN = 0.8;   // spec §4.5: below this = under-training (grey)
export const ACWR_OK_MAX = 1.3;   // spec §4.5: sweet spot upper bound (green)
export const ACWR_WATCH_MAX = 1.5; // spec §4.5: elevated injury risk (amber)
// > ACWR_WATCH_MAX = act (red)

// ---- Weekly volume progression (spec §4.6) ----------------------------------
export const WEEKLY_VOLUME_LIMIT_PCT = 10;      // spec §4.6: standard 10% rule
export const WEEKLY_VOLUME_LIMIT_LOW_BASE_PCT = 15; // spec §4.6: base < 4 h

// ---- Resting Heart Rate baseline (spec §4.1) --------------------------------
export const RHR_WATCH_BPM = 3;   // spec §4.1: +3–4 bpm above 30-day mean
export const RHR_ACT_BPM = 5;     // spec §4.1: ≥ +5 bpm above 30-day mean
export const RHR_BASELINE_MIN_DAYS = 14; // spec §4.1: minimum days for a valid baseline

// ---- Sleep duration (spec §4.3) ---------------------------------------------
export const SLEEP_TARGET_S = 7.5 * 3600; // spec §4.3: 7.5 h target
export const SLEEP_WATCH_S = 7 * 3600;    // spec §4.3: below 7 h → watch
export const SLEEP_ACT_S = 6 * 3600;      // spec §4.3: act only on 2nd consecutive night < 6 h

// ---- Bedtime consistency (spec §4.14) ---------------------------------------
export const BEDTIME_WATCH_STD_MIN = 30;  // spec §4.14: SD > 30 min → watch
export const BEDTIME_ACT_STD_MIN = 60;    // spec §4.14: SD > 60 min → act

// ---- Hard-day streak / quality sessions (spec §4.7) ------------------------
// quality: (aerobic_te >= 4.0 AND duration < 90 min) OR anaerobic_te >= 2.0
export const QUALITY_AEROBIC_TE = 4.0;        // spec §4.7
export const QUALITY_ANAEROBIC_TE = 2.0;      // spec §4.7
export const QUALITY_DURATION_MAX_S = 90 * 60; // spec §4.7: aerobic_te branch requires short session
// long: duration >= 90 min (no TE condition; run/swim/bike only; hikes excluded)
export const LONG_DURATION_S = 90 * 60;        // spec §4.7
export const HARD_DAY_STREAK_WATCH = 2;   // spec §4.7: 2 hard days in a row → watch
export const HARD_DAY_STREAK_ACT = 3;     // spec §4.7: ≥ 3 → act
export const WEEKLY_COUNTING_SESSIONS = 3; // spec §4.10: Q2 default for streak counting
export const QUALITY_SESSIONS_TARGET = 3;  // spec §4.7: ≤ 3 quality sessions/week

// ---- Long run share (spec §4.8) ---------------------------------------------
export const LONG_RUN_SHARE_WATCH = 0.30; // spec §4.8: > 30% → watch
export const LONG_RUN_SHARE_ACT = 0.40;   // spec §4.8: > 40% → act
export const LONG_RUN_MIN_RUNS = 3;       // spec §4.8: na if < 3 runs in week

// ---- Days since last session (spec §4.9) ------------------------------------
export const DAYS_SINCE_WATCH_ENDURANCE = 7;  // spec §4.9: swim/bike/run ≥ 7 d → watch (default)
export const DAYS_SINCE_ACT_ENDURANCE = 14;   // spec §4.9: swim/bike/run ≥ 14 d → act (default)
export const DAYS_SINCE_WATCH_STRENGTH = 8;   // spec §4.9: strength ≥ 8 d → watch (default)

// ---- Strength / mobility (spec §4.12) ---------------------------------------
export const STRENGTH_SESSION_TARGET = 2; // spec §4.12: ≥ 2 sessions/week

// ---- Intensity minutes (spec §4.13) ----------------------------------------
export const INTENSITY_MIN_TARGET = 150;  // spec §4.13: WHO 150 moderate-equiv min/week

// ---- Weight rate of change (spec §4.16) -------------------------------------
export const WEIGHT_WATCH_LOSS_KG_WEEK = 0.5; // spec §4.16: > 0.5 kg/week loss → watch
export const WEIGHT_ACT_LOSS_KG_WEEK = 1.0;   // spec §4.16: > 1.0 kg/week loss → act
export const WEIGHT_MIN_WEIGH_INS = 4;         // spec §4.16: na if < 4 weigh-ins in 28 d
