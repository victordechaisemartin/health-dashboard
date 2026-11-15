import type { Activity } from "./data";
import type { Bucket } from "./metrics";
import { bucketOf, parseLocalDate } from "./metrics";
import {
  QUALITY_AEROBIC_TE, QUALITY_ANAEROBIC_TE, QUALITY_DURATION_MAX_S,
  LONG_DURATION_S,
} from "./targets";

export type WeekSummary = {
  weekStart: string; // "YYYY-MM-DD", local Monday
  inProgress: boolean;
  byBucket: Record<Bucket, {
    sessions: number;
    hours: number;
    km: number;
    load: number;
    longestDurationS: number;
    longestKm: number;
    qualitySessions: number;
    longSessions: number;
  }>;
  hardDays: number;
  activeDays: number;
  totalHours: number;
  totalLoad: number;
};

/** Monday of the week containing d (local midnight). Sunday → prior Monday. */
export function weekStart(d: Date): Date {
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
}

/** Format a Date as "YYYY-MM-DD" using local fields. */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const TRAINING_BUCKETS: Bucket[] = ["cycling", "running", "swimming", "walking", "weights"];

function emptyBucketRow() {
  return { sessions: 0, hours: 0, km: 0, load: 0, longestDurationS: 0, longestKm: 0, qualitySessions: 0, longSessions: 0 };
}

function emptyByBucket(): WeekSummary["byBucket"] {
  return {
    cycling: emptyBucketRow(), running: emptyBucketRow(), swimming: emptyBucketRow(),
    walking: emptyBucketRow(), weights: emptyBucketRow(), sleep: emptyBucketRow(),
  };
}

/** True if activity counts as a "quality" session per spec §4.7.
 *  Rule: anaerobic_te ≥ 2.0, OR (aerobic_te ≥ 4.0 AND duration < 90 min).
 *  Hikes excluded unless anaerobic_te ≥ 2.0. */
function isQuality(a: Activity): boolean {
  if (a.activity_type === "hiking" && (a.anaerobic_te ?? 0) < QUALITY_ANAEROBIC_TE) return false;
  return (
    (a.anaerobic_te ?? 0) >= QUALITY_ANAEROBIC_TE ||
    ((a.aerobic_te ?? 0) >= QUALITY_AEROBIC_TE && (a.duration_s ?? 0) < QUALITY_DURATION_MAX_S)
  );
}

/** True if activity counts as a "long" session per spec §4.7.
 *  Rule: duration ≥ 90 min — no TE condition.
 *  Restricted to run/swim/bike; hiking always excluded. */
function isLong(a: Activity, bucket: Bucket | null): boolean {
  if (!bucket || !["running", "swimming", "cycling"].includes(bucket)) return false;
  return (a.duration_s ?? 0) >= LONG_DURATION_S;
}

/** Build nWeeks of WeekSummary ending with the week that contains today. */
export function weeklySeries(activities: Activity[], nWeeks: number, today: Date): WeekSummary[] {
  const currentWeekStart = weekStart(today);

  // Build a map keyed by week-start string for fast lookup
  const weekMap = new Map<string, WeekSummary>();
  for (let i = nWeeks - 1; i >= 0; i--) {
    const ws = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() - i * 7);
    const key = localDateStr(ws);
    weekMap.set(key, {
      weekStart: key,
      inProgress: i === 0,
      byBucket: emptyByBucket(),
      hardDays: 0,
      activeDays: 0,
      totalHours: 0,
      totalLoad: 0,
    });
  }

  // Track hard-day dates per week (a hard day = ≥1 quality or long session)
  const hardDayDates = new Map<string, Set<string>>();
  const activeDayDates = new Map<string, Set<string>>();
  for (const key of weekMap.keys()) {
    hardDayDates.set(key, new Set());
    activeDayDates.set(key, new Set());
  }

  for (const a of activities) {
    const actDate = parseLocalDate(a.activity_date);
    const ws = weekStart(actDate);
    const wsKey = localDateStr(ws);
    const week = weekMap.get(wsKey);
    if (!week) continue;

    const bucket = bucketOf(a.activity_type);
    if (!bucket || bucket === "sleep") continue;

    const row = week.byBucket[bucket];
    row.sessions++;
    row.hours += (a.duration_s ?? 0) / 3600;
    row.km += (a.distance_m ?? 0) / 1000;
    row.load += a.training_load ?? 0;
    if ((a.duration_s ?? 0) > row.longestDurationS) row.longestDurationS = a.duration_s ?? 0;
    if ((a.distance_m ?? 0) / 1000 > row.longestKm) row.longestKm = (a.distance_m ?? 0) / 1000;

    const quality = isQuality(a);
    const long = isLong(a, bucket);
    if (quality) row.qualitySessions++;
    if (long) row.longSessions++;

    activeDayDates.get(wsKey)!.add(a.activity_date);
    if (quality || long) hardDayDates.get(wsKey)!.add(a.activity_date);
  }

  // Finalise totals
  for (const [key, week] of weekMap) {
    week.hardDays = hardDayDates.get(key)!.size;
    week.activeDays = activeDayDates.get(key)!.size;
    for (const bucket of TRAINING_BUCKETS) {
      week.totalHours += week.byBucket[bucket].hours;
      week.totalLoad += week.byBucket[bucket].load;
    }
  }

  return Array.from(weekMap.values());
}
