import { describe, it, expect } from "vitest";
import {
  rhrvBaseline, hrvStatus, sleepLast, todayVerdict,
  acuteChronicRatio, weeklyVolumeProgression, longRunShare,
  daysSinceSport, weeklyTrainingStreak, activeDaysYtd,
  strengthMobilityThisWeek, intensityMinutesThisWeek,
} from "./kpis";
import type { Activity, Daily, Hrv, Sleep } from "./data";
import type { WeekSummary } from "./weeks";

// ---- helpers ----------------------------------------------------------------

function makeDaily(date: string, resting_hr: number | null = 50): Daily {
  return {
    summary_date: date, resting_hr, total_steps: null, distance_m: null,
    total_calories: null, moderate_min: null, vigorous_min: null,
  };
}

function makeHrv(date: string, opts: Partial<Hrv> = {}): Hrv {
  return {
    hrv_date: date,
    last_night_avg: 65,
    last_night_5min_high: null,
    weekly_avg: null,
    baseline_low: 60,
    baseline_high: 75,
    status: "BALANCED",
    ...opts,
  };
}

function makeSleep(date: string, totalS: number | null, opts: Partial<Sleep> = {}): Sleep {
  return {
    sleep_date: date, total_sleep_s: totalS,
    deep_s: null, light_s: null, rem_s: null, sleep_score: null, ...opts,
  };
}

// 14 days of baseline data centred on avg=50 bpm
function baselineRows(today: Date, avg = 50): Daily[] {
  return Array.from({ length: 20 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 20 + i);
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return makeDaily(str, avg);
  });
}

const TODAY = new Date(2026, 10, 15); // Sun 15 Nov 2026 (local)
const todayStr = "2026-11-15";
const yestStr = "2026-11-14";

// ---- §4.1 rhrvBaseline ------------------------------------------------------

describe("rhrvBaseline §4.1", () => {
  it("ok: today's RHR within +3 bpm of baseline", () => {
    const rows = [...baselineRows(TODAY), makeDaily(todayStr, 51)]; // +1 vs 50 baseline
    const r = rhrvBaseline(rows, TODAY);
    expect(r.status).toBe("ok");
    expect(r.value).toBe(51);
  });

  it("watch: +3 bpm above baseline", () => {
    const rows = [...baselineRows(TODAY), makeDaily(todayStr, 53)]; // +3
    const r = rhrvBaseline(rows, TODAY);
    expect(r.status).toBe("watch");
  });

  it("act: +5 bpm above baseline", () => {
    const rows = [...baselineRows(TODAY), makeDaily(todayStr, 55)]; // +5
    const r = rhrvBaseline(rows, TODAY);
    expect(r.status).toBe("act");
  });

  it("na: fewer than 14 baseline days", () => {
    // Only 5 prior rows
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeDaily(`2026-11-${String(10 - i).padStart(2, "0")}`, 50)
    );
    rows.push(makeDaily(todayStr, 50));
    const r = rhrvBaseline(rows, TODAY);
    expect(r.status).toBe("na");
    expect(r.reason).toBeTruthy();
  });

  it("§6/7 gaps: 3-day gap in data still uses ≥14 valid values", () => {
    // 20 prior rows with 3 of them missing (simulated by giving 17 rows)
    const rows = Array.from({ length: 17 }, (_, i) => {
      const d = new Date(2026, 10, 15 - 17 + i);
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return makeDaily(s, 50);
    });
    rows.push(makeDaily(todayStr, 51));
    const r = rhrvBaseline(rows, TODAY);
    // 17 prior rows ≥ 14 → baseline valid
    expect(r.status).toBe("ok");
  });

  it("§6/11 no daily row for today → uses yesterday, notes 'yesterday'", () => {
    const rows = [...baselineRows(TODAY), makeDaily(yestStr, 51)];
    // No todayStr row
    const r = rhrvBaseline(rows.filter((d) => d.summary_date !== todayStr), TODAY);
    expect(r.status).not.toBe("na");
    expect(r.rule).toContain("yesterday");
  });

  it("§6/11 no row for today or yesterday → na", () => {
    const rows = baselineRows(TODAY); // no today or yesterday row
    const filtered = rows.filter((d) => d.summary_date !== todayStr && d.summary_date !== yestStr);
    const r = rhrvBaseline(filtered, TODAY);
    expect(r.status).toBe("na");
  });

  it("today row exists but resting_hr null → falls back to yesterday", () => {
    // 20 prior rows that stop at 2026-11-13 (not yesterday), so yestStr is unambiguous
    const prior = Array.from({ length: 20 }, (_, i) => {
      const d = new Date(2026, 10, 15 - 21 + i); // 2026-10-25 to 2026-11-13
      return makeDaily(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        50
      );
    });
    const rows = [...prior, makeDaily(todayStr, null), makeDaily(yestStr, 51)];
    const r = rhrvBaseline(rows, TODAY);
    expect(r.status).not.toBe("na");
    expect(r.value).toBe(51);
    expect(r.rule).toContain("yesterday");
  });

  it("today null + no yesterday → na", () => {
    // baseline rows without yesterday, today row has null resting_hr
    const rows = [...baselineRows(TODAY).filter((d) => d.summary_date !== yestStr), makeDaily(todayStr, null)];
    const r = rhrvBaseline(rows, TODAY);
    expect(r.status).toBe("na");
  });
});

// ---- §4.2 hrvStatus ---------------------------------------------------------

describe("hrvStatus §4.2", () => {
  it("ok: BALANCED today", () => {
    const rows = [makeHrv(todayStr, { status: "BALANCED", last_night_avg: 65 })];
    const r = hrvStatus(rows, TODAY);
    expect(r.status).toBe("ok");
  });

  it("watch: single LOW night", () => {
    const rows = [makeHrv(todayStr, { status: "LOW", last_night_avg: 55 })];
    const r = hrvStatus(rows, TODAY);
    expect(r.status).toBe("watch");
  });

  it("act: LOW/UNBALANCED 2 consecutive nights (today + yesterday)", () => {
    const rows = [
      makeHrv(yestStr, { status: "LOW", last_night_avg: 55 }),
      makeHrv(todayStr, { status: "LOW", last_night_avg: 54 }),
    ];
    const r = hrvStatus(rows, TODAY);
    expect(r.status).toBe("act");
  });

  it("§6/7 non-consecutive: LOW today but gap before yesterday → watch, not act", () => {
    // yesterday row is missing (3-day gap); only today is LOW
    const rows = [
      makeHrv("2026-11-11", { status: "LOW" }), // 4 days ago — not consecutive
      makeHrv(todayStr, { status: "LOW", last_night_avg: 55 }),
    ];
    const r = hrvStatus(rows, TODAY);
    expect(r.status).toBe("watch");
  });

  it("na: no HRV row for today", () => {
    const r = hrvStatus([], TODAY);
    expect(r.status).toBe("na");
    expect(r.reason).toBeTruthy();
  });

  it("na: NO_STATUS", () => {
    const rows = [makeHrv(todayStr, { status: "NO_STATUS", last_night_avg: null })];
    const r = hrvStatus(rows, TODAY);
    expect(r.status).toBe("na");
  });
});

// ---- §4.3 sleepLast ---------------------------------------------------------

describe("sleepLast §4.3", () => {
  it("ok: ≥ 7.5 h", () => {
    const r = sleepLast([makeSleep(todayStr, 7.5 * 3600)], TODAY);
    expect(r.status).toBe("ok");
  });

  it("watch: 6–7.5 h single night", () => {
    const r = sleepLast([makeSleep(todayStr, 7 * 3600)], TODAY);
    expect(r.status).toBe("watch");
  });

  it("watch: single night < 6 h (not consecutive)", () => {
    const r = sleepLast([makeSleep(todayStr, 5.5 * 3600)], TODAY);
    expect(r.status).toBe("watch"); // only act on 2nd consecutive
  });

  it("act: < 6 h two nights running", () => {
    const rows = [
      makeSleep(yestStr, 5 * 3600),
      makeSleep(todayStr, 5.5 * 3600),
    ];
    const r = sleepLast(rows, TODAY);
    expect(r.status).toBe("act");
  });

  it("na: no sleep row", () => {
    const r = sleepLast([], TODAY);
    expect(r.status).toBe("na");
    expect(r.reason).toBeTruthy();
  });
});

// ---- §4.4 todayVerdict ------------------------------------------------------

describe("todayVerdict §4.4", () => {
  const OK: import("./kpis").KpiResult = { value: 50, status: "ok", rule: "ok" };
  const WATCH: import("./kpis").KpiResult = { value: 50, status: "watch", rule: "watch" };
  const ACT: import("./kpis").KpiResult = { value: 50, status: "act", rule: "act" };
  const NA: import("./kpis").KpiResult = { value: null, status: "na", rule: "na", reason: "missing" };

  it("Go: all ok", () => {
    expect(todayVerdict(OK, OK, OK).value).toBe("Go");
  });

  it("Easy: single act (RHR only)", () => {
    expect(todayVerdict(ACT, OK, OK).value).toBe("Easy");
  });

  it("Easy: ≥ 2 watch", () => {
    expect(todayVerdict(WATCH, WATCH, OK).value).toBe("Easy");
  });

  it("Rest/easy: HRV act + sleep act", () => {
    expect(todayVerdict(OK, ACT, ACT).value).toBe("Rest / easy only");
  });

  it("Rest/easy: HRV act + RHR act", () => {
    expect(todayVerdict(ACT, ACT, OK).value).toBe("Rest / easy only");
  });

  it("No verdict: HRV and sleep both na", () => {
    const r = todayVerdict(OK, NA, NA);
    expect(r.value).toBeNull();
    expect(r.status).toBe("na");
  });

  it("verdict still possible when only sleep is na", () => {
    // HRV is present and act → Easy
    expect(todayVerdict(OK, ACT, NA).value).toBe("Easy");
  });
});

// ---- T020 helpers -----------------------------------------------------------

function makeActivity(date: string, overrides: Partial<Activity> = {}): Activity {
  return {
    activity_id: 1, activity_date: date, activity_type: "running",
    duration_s: 3600, distance_m: 10000, training_load: 100,
    aerobic_te: 3.0, anaerobic_te: 0,
    avg_hr: null, calories: null, name: null, created_at: null,
    ...overrides,
  };
}

function makeWeek(weekStart: string, totalHours: number, opts: {
  inProgress?: boolean;
  runKm?: number;
  runSessions?: number;
  longestKm?: number;
  qualitySessions?: number;
} = {}): WeekSummary {
  const emptyBucket = () => ({ sessions: 0, hours: 0, km: 0, load: 0, longestDurationS: 0, longestKm: 0, qualitySessions: 0, longSessions: 0 });
  return {
    weekStart,
    inProgress: opts.inProgress ?? false,
    byBucket: {
      cycling: emptyBucket(),
      running: {
        sessions: opts.runSessions ?? 3,
        hours: totalHours,
        km: opts.runKm ?? totalHours * 10,
        load: 0,
        longestDurationS: 0,
        longestKm: opts.longestKm ?? (opts.runKm ?? totalHours * 10) * 0.25,
        qualitySessions: opts.qualitySessions ?? 0,
        longSessions: 0,
      },
      swimming: emptyBucket(),
      walking: emptyBucket(),
      weights: emptyBucket(),
      sleep: emptyBucket(),
    },
    hardDays: 0,
    activeDays: 3,
    totalHours,
    totalLoad: 0,
  };
}

// ---- T020: phase 4 KPI edge cases -------------------------------------------

describe("acuteChronicRatio §4.5", () => {
  it("§6/6 chronic=0 → na", () => {
    // 21 daily rows present (coverage ok) but zero activities → chronic=0
    const daily: Daily[] = Array.from({ length: 22 }, (_, i) => {
      const d = new Date(2026, 10, 15 - 21 + i);
      return makeDaily(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        50
      );
    });
    const r = acuteChronicRatio([], daily, TODAY);
    expect(r.status).toBe("na");
    expect(r.reason).toBeTruthy();
  });
});

describe("weeklyVolumeProgression §4.6", () => {
  it("§6/4 recovery-week rebound: 5→5→5→3(recovery)→5h, baseline=5h → 0% → ok", () => {
    const weeks = [
      makeWeek("2026-10-05", 5),
      makeWeek("2026-10-12", 5),
      makeWeek("2026-10-19", 5),
      makeWeek("2026-10-26", 3),  // recovery week
      makeWeek("2026-11-02", 5),  // bounce back = 0% vs 5h baseline
    ];
    const { hours } = weeklyVolumeProgression(weeks, TODAY);
    expect(hours.status).toBe("ok");
  });

  it("§6/5 low base: 3h→3h→3h prior, 3.4h current (+13% < 15% limit) → ok", () => {
    const weeks = [
      makeWeek("2026-10-19", 3),
      makeWeek("2026-10-26", 3),
      makeWeek("2026-11-02", 3),
      makeWeek("2026-11-09", 3.4), // +13% of 3h base < 15% low-base limit
    ];
    const { hours } = weeklyVolumeProgression(weeks, TODAY);
    expect(hours.status).toBe("ok");
  });
});

describe("longRunShare §4.8", () => {
  it("§6/9 only 1 run last week → na", () => {
    const weeks = [makeWeek("2026-11-09", 5, { runSessions: 1, runKm: 20, longestKm: 20 })];
    const r = longRunShare(weeks, TODAY);
    expect(r.status).toBe("na");
  });
});

// ---- Phase 5: §4.9–4.13 -----------------------------------------------------

function makeRunActivity(date: string, daysAgo = 0): Activity {
  const d = new Date(2026, 10, 15 - daysAgo);
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return makeActivity(s.length > 0 ? s : date, { activity_type: "running" });
}

describe("daysSinceSport §4.9", () => {
  it("ok: ran today", () => {
    const acts = [makeActivity(todayStr, { activity_type: "running" })];
    const r = daysSinceSport(acts, TODAY);
    expect(r.run.value).toBe(0);
    expect(r.run.status).toBe("ok");
  });

  it("watch: last swim 8 days ago", () => {
    const d = new Date(2026, 10, 7); // 8 days before Nov 15
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const acts = [makeActivity(dateStr, { activity_type: "swimming" })];
    const r = daysSinceSport(acts, TODAY);
    expect(r.swim.status).toBe("watch");
    expect(r.swim.value).toBe(8);
  });

  it("act: last run 14 days ago", () => {
    const d = new Date(2026, 10, 1);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const acts = [makeActivity(dateStr, { activity_type: "running" })];
    const r = daysSinceSport(acts, TODAY);
    expect(r.run.status).toBe("act");
  });

  it("na: no strength ever", () => {
    const r = daysSinceSport([], TODAY);
    expect(r.strength.status).toBe("na");
    expect(r.strength.reason).toBeTruthy();
  });
});

function makeCountingWeek(weekStart: string, sessions = 4, inProgress = false): WeekSummary {
  return makeWeek(weekStart, sessions * 1.0, { inProgress, runSessions: sessions });
}

describe("weeklyTrainingStreak §4.10", () => {
  it("3 consecutive counting weeks → streak = 3", () => {
    const weeks = [
      makeCountingWeek("2026-10-26"),
      makeCountingWeek("2026-11-02"),
      makeCountingWeek("2026-11-09"),
      makeWeek("2026-11-15", 1, { inProgress: true, runSessions: 1 }), // current, not yet counting
    ];
    const r = weeklyTrainingStreak(weeks, TODAY);
    expect(r.value).toBe(3);
  });

  it("current week extends streak when it qualifies", () => {
    const weeks = [
      makeCountingWeek("2026-11-09"),
      makeCountingWeek("2026-11-15", 4, true), // current week already has 4 sessions
    ];
    const r = weeklyTrainingStreak(weeks, TODAY);
    expect(r.value).toBe(2);
  });

  it("non-counting week breaks streak", () => {
    const weeks = [
      makeCountingWeek("2026-10-26"),
      makeWeek("2026-11-02", 1, { runSessions: 1 }), // only 1 session — not counting
      makeCountingWeek("2026-11-09"),
    ];
    const r = weeklyTrainingStreak(weeks, TODAY);
    expect(r.value).toBe(1); // only last completed week counts
  });
});

describe("strengthMobilityThisWeek §4.12", () => {
  const WEDNESDAY = new Date(2026, 10, 11); // Wed 11 Nov 2026
  const THURSDAY = new Date(2026, 10, 12);  // Thu 12 Nov 2026

  it("0 sessions on Wednesday → ok (too early)", () => {
    const weeks = [makeWeek("2026-11-09", 3, { inProgress: true })]; // 0 strength sessions
    const r = strengthMobilityThisWeek(weeks, WEDNESDAY);
    expect(r.status).toBe("ok");
  });

  it("0 sessions on Thursday → act", () => {
    const weeks = [makeWeek("2026-11-09", 3, { inProgress: true })];
    const r = strengthMobilityThisWeek(weeks, THURSDAY);
    expect(r.status).toBe("act");
  });

  it("2 sessions any day → ok", () => {
    const w = makeWeek("2026-11-09", 3, { inProgress: true });
    w.byBucket.weights.sessions = 2;
    const r = strengthMobilityThisWeek([w], THURSDAY);
    expect(r.status).toBe("ok");
  });
});

describe("intensityMinutesThisWeek §4.13", () => {
  it("ok: ≥ 150 intensity minutes", () => {
    // Monday + Tuesday with enough minutes
    const daily: Daily[] = [
      makeDaily("2026-11-09", 50), // Mon (but that's last week — Mon is Nov 10)
      makeDaily("2026-11-10", 50),
      makeDaily("2026-11-11", 50),
    ];
    daily[0].moderate_min = 80; daily[0].vigorous_min = 0;
    daily[1].moderate_min = 50; daily[1].vigorous_min = 25; // 50 + 50 = 100 → total 180
    daily[2].moderate_min = 0;  daily[2].vigorous_min = 0;
    // Week of Nov 15 starts on Mon Nov 10
    const mon = new Date(2026, 10, 10);
    // Mon-Tue: 80 + (50 + 50) = 180 >= 150
    const r = intensityMinutesThisWeek([daily[0], daily[1]], new Date(2026, 10, 11));
    expect(r.status).toBe("ok");
  });

  it("watch: < 150 intensity minutes", () => {
    const daily: Daily[] = [makeDaily("2026-11-10", 50)];
    daily[0].moderate_min = 30; daily[0].vigorous_min = 0;
    const r = intensityMinutesThisWeek(daily, new Date(2026, 10, 10));
    expect(r.status).toBe("watch");
  });
});
