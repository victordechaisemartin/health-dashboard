import { describe, it, expect } from "vitest";
import { bucketOf, parseLocalDate, periods } from "./metrics";

// vitest runs with TZ=Europe/Paris (see "test" script in package.json); the
// DST-sensitive assertions below depend on that.

describe("bucketOf", () => {
  it("maps running/cycling/swimming/walking family types", () => {
    expect(bucketOf("running")).toBe("running");
    expect(bucketOf("trail_running")).toBe("running");
    expect(bucketOf("cycling")).toBe("cycling");
    expect(bucketOf("virtual_ride")).toBe("cycling");
    expect(bucketOf("lap_swimming")).toBe("swimming");
    expect(bucketOf("hiking")).toBe("walking");
    expect(bucketOf("yoga")).toBe("mobility");
    expect(bucketOf("strength_training")).toBe("strength");
  });
  it("is case-insensitive", () => {
    expect(bucketOf("Running")).toBe("running");
  });
  it("returns null for null/empty/unknown", () => {
    expect(bucketOf(null)).toBeNull();
    expect(bucketOf(undefined)).toBeNull();
    expect(bucketOf("")).toBeNull();
    expect(bucketOf("unknown_sport")).toBeNull();
  });
});

describe("parseLocalDate", () => {
  it("parses a YYYY-MM-DD column at local midnight (not UTC)", () => {
    const d = parseLocalDate("2026-11-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10); // 0-indexed → November
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });
  it("handles January 31", () => {
    const d = parseLocalDate("2026-01-31");
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(31);
  });
  it("handles Feb 28 on a common year", () => {
    const d = parseLocalDate("2026-02-28");
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(28);
  });
  it("is stable on the Europe/Paris DST spring-forward day (2026-03-29)", () => {
    const d = parseLocalDate("2026-03-29");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(29);
  });
  it("is stable on the Europe/Paris DST fall-back day (2026-10-25)", () => {
    const d = parseLocalDate("2026-10-25");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(25);
  });
});

describe("periods", () => {
  it("'30d' yields 30 inclusive calendar days and an adjacent prior 30-day window", () => {
    const now = new Date(2026, 10, 15);
    const { current, prev } = periods(now, "30d");
    expect(current.label).toBe("Last 30 days");
    // 30 days inclusive = 29-day span in ms (start-of-day-N-29 → end-of-day-N).
    const dayMs = 86_400_000;
    expect(Math.round((current.end.getTime() - current.start.getTime()) / dayMs)).toBe(29);
    expect(Math.round((prev.end.getTime() - prev.start.getTime()) / dayMs)).toBe(29);
    expect(prev.end.getTime()).toBeLessThan(current.start.getTime());
  });

  it("'year' starts Jan 1 of 'now' and mirrors last year's same span", () => {
    const now = new Date(2026, 10, 15);
    const { current, prev } = periods(now, "year");
    expect(current.start.getFullYear()).toBe(2026);
    expect(current.start.getMonth()).toBe(0);
    expect(current.start.getDate()).toBe(1);
    expect(current.label).toBe("2026 YTD");
    expect(prev.start.getFullYear()).toBe(2025);
    expect(prev.end.getMonth()).toBe(10);
    expect(prev.end.getDate()).toBe(15);
  });

  it("'month' at Nov 15 pairs Nov MTD with Oct 1-15", () => {
    const now = new Date(2026, 10, 15);
    const { current, prev } = periods(now, "month");
    expect(current.start.getMonth()).toBe(10);
    expect(current.start.getDate()).toBe(1);
    expect(prev.start.getMonth()).toBe(9);
    expect(prev.start.getDate()).toBe(1);
    expect(prev.end.getMonth()).toBe(9);
    expect(prev.end.getDate()).toBe(15);
  });

  it("'month' on the last day of a 30-day month pairs with the 30th of prev month", () => {
    // Nov 30, 2026 → prev end is Oct 30 (Oct has 31 so the date is valid)
    const now = new Date(2026, 10, 30);
    const { prev } = periods(now, "month");
    expect(prev.start.getMonth()).toBe(9);
    expect(prev.end.getDate()).toBe(30);
  });
});
