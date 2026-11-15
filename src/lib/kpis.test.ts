import { describe, it, expect } from "vitest";
import { rhrvBaseline, hrvStatus, sleepLast, todayVerdict } from "./kpis";
import type { Daily, Hrv, Sleep } from "./data";

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
