import { describe, it, expect } from "vitest";
import { weekStart, weeklySeries } from "./weeks";
import type { Activity } from "./data";

// ---- helpers ----------------------------------------------------------------

function makeActivity(overrides: Partial<Activity> & { activity_date: string }): Activity {
  return {
    activity_id: Math.random(),
    activity_type: "running",
    name: null,
    duration_s: 3600,
    distance_m: 10000,
    avg_hr: null,
    calories: null,
    training_load: 100,
    aerobic_te: 3.0,
    anaerobic_te: 0.5,
    ...overrides,
  };
}

/** Build an Activity on the given date with explicit hour/min in local time.
 *  `activity_date` is always the local date string (what the DB stores). */
function activityOnDate(date: string, opts?: Partial<Activity>): Activity {
  return makeActivity({ activity_date: date, ...opts });
}

// ---- §6/1 — activity at 23:30 Sunday local → belongs to that week ----------

describe("weekStart", () => {
  it("§6/1 Sunday 2026-11-15 → Monday 2026-11-09", () => {
    // 15 Nov 2026 is a Sunday
    const sun = new Date(2026, 10, 15); // local midnight
    expect(sun.getDay()).toBe(0); // sanity: it's a Sunday
    const ws = weekStart(sun);
    expect(ws.getFullYear()).toBe(2026);
    expect(ws.getMonth()).toBe(10); // November (0-indexed)
    expect(ws.getDate()).toBe(9);   // Monday Nov 9
  });

  it("Monday stays as itself", () => {
    const mon = new Date(2026, 10, 9); // Nov 9 = Monday
    const ws = weekStart(mon);
    expect(ws.getDate()).toBe(9);
  });

  it("Saturday maps to Monday", () => {
    const sat = new Date(2026, 10, 14); // Nov 14 = Saturday
    const ws = weekStart(sat);
    expect(ws.getDate()).toBe(9);
  });
});

// ---- §6/2 — DST boundaries don't corrupt week counts -----------------------

describe("§6/2 DST boundaries", () => {
  it("week containing 29 Mar 2026 (CET→CEST) is exactly 7 days long", () => {
    // Monday 23 Mar 2026 → Sunday 29 Mar 2026 (clocks go forward on 29th)
    const mon = new Date(2026, 2, 23); // 23 Mar, Monday
    const sun = new Date(2026, 2, 29); // 29 Mar, Sunday
    expect(weekStart(sun).getTime()).toBe(mon.getTime());
    // The week from Mon 23 to Mon 30 is 7 × 86400000 ms in wall-clock time,
    // but the DST day is 23h so total is 7 days - 1h. Using Date(y,m,d) we
    // always work in local days, so this is transparent.
    const nextMon = weekStart(new Date(2026, 2, 30));
    expect(nextMon.getDate()).toBe(30);
  });

  it("week containing 25 Oct 2026 (CEST→CET) is still 7 calendar days", () => {
    // Monday 19 Oct 2026 → Sunday 25 Oct 2026 (clocks go back on 25th)
    const sun = new Date(2026, 9, 25); // 25 Oct, Sunday
    const ws = weekStart(sun);
    expect(ws.getDate()).toBe(19);
    expect(ws.getMonth()).toBe(9); // October
  });
});

// ---- §6/3 — multi_sport excluded; individual legs counted once each --------

describe("§6/3 multisport legs counted once; parent excluded", () => {
  it("multi_sport activity is excluded from weeklySeries counts", () => {
    const today = new Date(2026, 10, 10); // Monday
    const acts = [
      activityOnDate("2026-11-10", { activity_type: "multi_sport", duration_s: 7200 }),
      activityOnDate("2026-11-10", { activity_type: "swimming", duration_s: 1200, distance_m: 1500 }),
      activityOnDate("2026-11-10", { activity_type: "cycling", duration_s: 3600, distance_m: 40000 }),
      activityOnDate("2026-11-10", { activity_type: "running", duration_s: 1800, distance_m: 10000 }),
    ];
    const [week] = weeklySeries(acts, 1, today);
    // multi_sport contributes nothing; swim/bike/run each count once
    expect(week.byBucket.swimming.sessions).toBe(1);
    expect(week.byBucket.cycling.sessions).toBe(1);
    expect(week.byBucket.running.sessions).toBe(1);
    // totalHours = swim (0.333h) + bike (1h) + run (0.5h) = ~1.833h (no multi_sport)
    expect(week.totalHours).toBeCloseTo(1.833, 2);
  });
});

// ---- §6/4–5 — recovery-week rebound and low-base --------------------------
// weeklySeries computes hours correctly so the KPI can apply the right rule.

describe("§6/4-5 weekly hours for rebound scenarios", () => {
  function buildWeeks(hoursPerWeek: number[], baseMonday: Date): Activity[] {
    const acts: Activity[] = [];
    for (let i = 0; i < hoursPerWeek.length; i++) {
      const weekMon = new Date(baseMonday.getFullYear(), baseMonday.getMonth(), baseMonday.getDate() + i * 7);
      const dateStr = `${weekMon.getFullYear()}-${String(weekMon.getMonth() + 1).padStart(2, "0")}-${String(weekMon.getDate()).padStart(2, "0")}`;
      acts.push(activityOnDate(dateStr, { duration_s: hoursPerWeek[i] * 3600, distance_m: 10000 }));
    }
    return acts;
  }

  it("§6/4 recovery-week rebound: 5,5,5,3,5h → last week = 5h", () => {
    const base = new Date(2026, 6, 6); // Monday 6 Jul 2026
    const acts = buildWeeks([5, 5, 5, 3, 5], base);
    const today = new Date(2026, 6, 6 + 4 * 7); // Monday of week 5
    const series = weeklySeries(acts, 5, today);
    // Last completed week (index 3, inProgress=false) has 3h
    // Current in-progress week (index 4) has 5h
    const completed = series.filter((w) => !w.inProgress);
    expect(completed[completed.length - 1].totalHours).toBeCloseTo(3, 1);
    const current = series.find((w) => w.inProgress)!;
    expect(current.totalHours).toBeCloseTo(5, 1);
  });

  it("§6/5 low base: 3h base → 3.4h current, correct hours computed", () => {
    const base = new Date(2026, 6, 6);
    const acts = buildWeeks([3, 3, 3, 3, 3.4], base);
    const today = new Date(2026, 6, 6 + 4 * 7);
    const series = weeklySeries(acts, 5, today);
    const current = series.find((w) => w.inProgress)!;
    expect(current.totalHours).toBeCloseTo(3.4, 1);
  });
});

// ---- §6/9 — week with 1 run → longRunShare n/a check (count in series) -----

describe("§6/9 week with 1 run", () => {
  it("only 1 run in the week is recorded correctly in byBucket.running.sessions", () => {
    const today = new Date(2026, 10, 10);
    const acts = [activityOnDate("2026-11-10", { activity_type: "running", distance_m: 20000 })];
    const [week] = weeklySeries(acts, 1, today);
    expect(week.byBucket.running.sessions).toBe(1);
    // The KPI function (not tested here) must return n/a for longRunShare when sessions < 3
  });
});

// ---- §6/10 — indoor ride 0 km → hours/load counted, km ignored -------------

describe("§6/10 indoor ride with 0 km", () => {
  it("counts for hours and load, km stays 0", () => {
    const today = new Date(2026, 10, 10);
    const acts = [activityOnDate("2026-11-10", {
      activity_type: "cycling",
      duration_s: 3600,
      distance_m: 0,
      training_load: 80,
    })];
    const [week] = weeklySeries(acts, 1, today);
    expect(week.byBucket.cycling.sessions).toBe(1);
    expect(week.byBucket.cycling.hours).toBeCloseTo(1, 2);
    expect(week.byBucket.cycling.km).toBe(0);
    expect(week.byBucket.cycling.load).toBe(80);
  });
});

// ---- §6/12 — hike quality/long exclusion -----------------------------------

describe("§6/12 hike classification", () => {
  it("3h hike aerobic_te 4.2 / anaerobic_te 0.8 → not quality, not long, not hard day", () => {
    const today = new Date(2026, 10, 10);
    const acts = [activityOnDate("2026-11-10", {
      activity_type: "hiking",
      duration_s: 3 * 3600,
      aerobic_te: 4.2,
      anaerobic_te: 0.8,
    })];
    const [week] = weeklySeries(acts, 1, today);
    // hiking maps to "walking" bucket
    expect(week.byBucket.walking.qualitySessions).toBe(0);
    expect(week.byBucket.walking.longSessions).toBe(0);
    expect(week.hardDays).toBe(0);
  });

  it("same hike with anaerobic_te 2.1 → quality → 1 hard day", () => {
    const today = new Date(2026, 10, 10);
    const acts = [activityOnDate("2026-11-10", {
      activity_type: "hiking",
      duration_s: 3 * 3600,
      aerobic_te: 4.2,
      anaerobic_te: 2.1,
    })];
    const [week] = weeklySeries(acts, 1, today);
    expect(week.byBucket.walking.qualitySessions).toBe(1);
    expect(week.hardDays).toBe(1);
  });
});

// ---- §6/13 — 2h easy run → long session → hard day -----------------------

describe("§6/13 long run classification", () => {
  it("2h run aerobic_te 3.8 → long (≥90 min + aerobic_te ≥ 2.5) → hard day", () => {
    const today = new Date(2026, 10, 10);
    const acts = [activityOnDate("2026-11-10", {
      activity_type: "running",
      duration_s: 2 * 3600, // 2h >= LONG_DURATION_S (90 min)
      aerobic_te: 3.8,       // >= LONG_AEROBIC_TE (2.5)
      anaerobic_te: 0.5,
      distance_m: 20000,
    })];
    const [week] = weeklySeries(acts, 1, today);
    expect(week.byBucket.running.longSessions).toBe(1);
    expect(week.hardDays).toBe(1);
  });

  it("2h run aerobic_te 3.4 is NOT quality (aerobic_te < 4.0, anaerobic_te < 2.0)", () => {
    const today = new Date(2026, 10, 10);
    const acts = [activityOnDate("2026-11-10", {
      activity_type: "running",
      duration_s: 2 * 3600,
      aerobic_te: 3.4, // below QUALITY_AEROBIC_TE (3.5)
      anaerobic_te: 0.5,
    })];
    const [week] = weeklySeries(acts, 1, today);
    expect(week.byBucket.running.qualitySessions).toBe(0);
  });
});
