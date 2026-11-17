import { describe, it, expect } from "vitest";
import { lastRefreshed, type Bundle } from "./data";

function bundle(partial: Partial<Bundle>): Bundle {
  return {
    weighIns: [], activities: [], sleep: [], daily: [],
    dexa: [], bloods: [], hrv: [], lastSync: null, source: "supabase",
    ...partial,
  };
}

describe("lastRefreshed", () => {
  it("returns null when nothing has a created_at", () => {
    expect(lastRefreshed(bundle({}))).toBeNull();
  });

  it("returns null when every row is missing created_at", () => {
    expect(lastRefreshed(bundle({
      sleep: [{ sleep_date: "2026-11-14" } as any],
    }))).toBeNull();
  });

  it("picks the newest created_at across activities / daily / sleep / weighIns / hrv", () => {
    const r = lastRefreshed(bundle({
      activities: [{ activity_date: "2026-11-01", created_at: "2026-11-10T09:00:00Z" } as any],
      daily:      [{ summary_date: "2026-11-14", created_at: "2026-11-14T06:00:00Z" } as any],
      hrv:        [{ hrv_date:    "2026-11-15", created_at: "2026-11-15T05:00:00Z" } as any],
    }));
    expect(r).toMatch(/^Last refreshed /);
    // Max created_at is Nov 15 — must dominate even though hrv is scanned last.
    expect(r).toContain("15 Nov 2026");
  });

  it("includes hrv timestamps (regression: hrv was once skipped)", () => {
    const r = lastRefreshed(bundle({
      hrv: [{ hrv_date: "2026-11-15", created_at: "2026-12-20T01:02:03Z" } as any],
    }));
    expect(r).toContain("20 Dec 2026");
  });
});
