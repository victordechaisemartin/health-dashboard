import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Bundle } from "../lib/data";
import {
  ACTIVITY_BUCKETS, BUCKET_META, activitiesIn, fmtKm, fmtSteps, monthlySeries,
  periods, sleepStat, stepStat, windowStat, pct, today, dataFreshness,
  parseLocalDate, type Bucket, type PeriodKey,
} from "../lib/metrics";
import { AXIS_TICK, Card, GRID, KpiStat, PageHeader, Pill, PeriodMenu, TOOLTIP, Delta, StatusDot } from "../ui";
import {
  rhrvBaseline, hrvStatus, sleepLast, todayVerdict,
  daysSinceSport, weeklyTrainingStreak, activeDaysYtd,
  strengthMobilityThisWeek, intensityMinutesThisWeek, qualitySessionsThisWeek,
} from "../lib/kpis";
import { weeklySeries } from "../lib/weeks";

export default function Overview({ data, now, go, period, setPeriod, refreshed }: {
  data: Bundle; now: Date; go: (path: string) => void; period: PeriodKey; setPeriod: (p: PeriodKey) => void; refreshed?: string;
}) {
  const realToday = today();
  const { current, prev } = periods(now, period);

  const cards = useMemo(() => ACTIVITY_BUCKETS.map((b) => {
    const acts = activitiesIn(data.activities, b);
    return { bucket: b, curr: windowStat(acts, current), prevStat: windowStat(acts, prev) };
  }), [data, current, prev]);

  const sleepNow = sleepStat(data.sleep, current);
  const sleepPrev = sleepStat(data.sleep, prev);
  const stepNow = stepStat(data.daily, current);
  const stepPrev = stepStat(data.daily, prev);

  // stacked monthly hours per bucket (last 12 months)
  const trend = useMemo(() => {
    const series = ACTIVITY_BUCKETS.map((b) => monthlySeries(activitiesIn(data.activities, b), 12, now));
    return series[0].map((_, i) => {
      const row: Record<string, number | string> = { label: series[0][i].label };
      ACTIVITY_BUCKETS.forEach((b, bi) => (row[b] = series[bi][i].hours));
      return row;
    });
  }, [data, now]);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={`${current.label} vs ${prev.label} · ${data.activities.length} activities · ${data.sleep.length} sleep nights`}
        refreshed={refreshed}
        right={<PeriodMenu value={period} onChange={setPeriod} />}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ bucket, curr, prevStat }) =>
          bucket === "walking"
            ? <StepsCard key="walking" now={stepNow} prev={stepPrev} go={go} />
            : <ActivityCard key={bucket} bucket={bucket} curr={curr} prev={prevStat} go={go} />
        )}
        <SleepCard now={sleepNow} prev={sleepPrev} go={go} />
      </div>

      <TodayCard data={data} today={realToday} />
      <ThisWeekCard data={data} today={realToday} />

      <div className="mt-4">
        <Card className="p-5">
          <div className="mb-4">
            <h2 className="font-display text-base font-semibold text-white">Training hours by activity</h2>
            <p className="text-xs text-slate-500">last 12 months · stacked hours</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} stroke="#334155" />
              <YAxis tick={AXIS_TICK} stroke="#334155" unit="h" width={44} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => BUCKET_META[v as Bucket]?.label ?? v} />
              {ACTIVITY_BUCKETS.map((b) => (
                <Bar key={b} dataKey={b} stackId="h" fill={BUCKET_META[b].color} radius={[0, 0, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

function ActivityCard({ bucket, curr, prev, go }: {
  bucket: Bucket; curr: ReturnType<typeof windowStat>; prev: ReturnType<typeof windowStat>; go: (p: string) => void;
}) {
  const m = BUCKET_META[bucket];
  const tiles = m.distance
    ? [
        { label: "Distance", value: fmtKm(curr.distanceKm), unit: "km", d: pct(curr.distanceKm, prev.distanceKm) },
        { label: "Sessions", value: curr.sessions, unit: "", d: pct(curr.sessions, prev.sessions) },
        { label: "Time", value: (curr.durationS / 3600).toFixed(1), unit: "h", d: pct(curr.durationS, prev.durationS) },
      ]
    : [
        { label: "Sessions", value: curr.sessions, unit: "", d: pct(curr.sessions, prev.sessions) },
        { label: "Time", value: (curr.durationS / 3600).toFixed(1), unit: "h", d: pct(curr.durationS, prev.durationS) },
        { label: "Load", value: Math.round(curr.load), unit: "", d: pct(curr.load, prev.load) },
      ];
  return (
    <button
      onClick={() => go(`/activity/${bucket}`)}
      className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-left transition hover:border-slate-700 hover:bg-slate-900/70"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg text-xl" style={{ background: `${m.color}1a` }}>{m.icon}</span>
          <span className="font-display text-base font-semibold text-white">{m.label}</span>
        </div>
        <span className="text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-400">›</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label}>
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t.label}</div>
            <div className="mt-0.5 flex items-baseline gap-0.5">
              <span className="font-display text-xl font-semibold text-white" style={{ color: m.color }}>{t.value}</span>
              {t.unit && <span className="text-[10px] text-slate-500">{t.unit}</span>}
            </div>
            <Delta delta={t.d} suffix="" />
          </div>
        ))}
      </div>
    </button>
  );
}

function SleepCard({ now, prev, go }: {
  now: ReturnType<typeof sleepStat>; prev: ReturnType<typeof sleepStat>; go: (p: string) => void;
}) {
  const m = BUCKET_META.sleep;
  const tiles = [
    { label: "Avg score", value: now.avgScore ?? "–", unit: "", d: pct(now.avgScore || 0, prev.avgScore || 0) },
    { label: "Avg hours", value: now.avgHours ?? "–", unit: "h", d: pct(now.avgHours || 0, prev.avgHours || 0) },
    { label: "Nights", value: now.nights, unit: "", d: pct(now.nights, prev.nights) },
  ];
  return (
    <button
      onClick={() => go("/sleep")}
      className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-left transition hover:border-slate-700 hover:bg-slate-900/70"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg text-xl" style={{ background: `${m.color}1a` }}>{m.icon}</span>
          <span className="font-display text-base font-semibold text-white">{m.label}</span>
        </div>
        <span className="text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-400">›</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label}>
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t.label}</div>
            <div className="mt-0.5 flex items-baseline gap-0.5">
              <span className="font-display text-xl font-semibold text-white" style={{ color: m.color }}>{t.value}</span>
              {t.unit && <span className="text-[10px] text-slate-500">{t.unit}</span>}
            </div>
            <Delta delta={t.d} good={t.label !== "Avg hours" ? true : true} suffix="" />
          </div>
        ))}
      </div>
      <div className="mt-3"><Pill color={m.color}>Sleep quality tracked</Pill></div>
    </button>
  );
}

// ---- Today card (US-1) ------------------------------------------------------

function localDateLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

const VERDICT_COLOR: Record<string, string> = {
  "Go": "#34d399",
  "Easy": "#fbbf24",
  "Rest / easy only": "#f87171",
};

function TodayCard({ data, today: todayDate }: { data: Bundle; today: Date }) {
  const freshness = dataFreshness(data);

  // Stale if newest summary_date is older than yesterday
  const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
  const yesterdayDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 1);
  const yesterdayStr = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, "0")}-${String(yesterdayDate.getDate()).padStart(2, "0")}`;
  const stale = freshness.summaryDate != null && freshness.summaryDate < yesterdayStr;

  const rhr = rhrvBaseline(data.daily, todayDate);
  const hrv = hrvStatus(data.hrv, todayDate);
  const slp = sleepLast(data.sleep, todayDate);
  const verdict = todayVerdict(rhr, hrv, slp);

  // Steps today
  const todayDaily = data.daily.find((d) => d.summary_date === todayStr)
    ?? data.daily.find((d) => d.summary_date === yesterdayStr);
  const steps = todayDaily?.total_steps;
  const goal = todayDaily?.step_goal;
  const daySince = daysSinceSport(data.activities, todayDate);

  return (
    <div className="mb-5">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Today</span>
            <span className="text-xs text-slate-500">{localDateLabel(todayDate)}</span>
          </div>
          {freshness.summaryDate && (
            <span className="text-[11px] text-slate-600">Data as of {freshness.summaryDate}</span>
          )}
        </div>

        {stale ? (
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 px-4 py-3 text-sm text-slate-400">
            No data since {freshness.summaryDate} — watch not synced or not worn
          </div>
        ) : (
          <>
            {/* Verdict row */}
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              {verdict.value != null ? (
                <>
                  <span
                    className="font-display text-lg font-semibold"
                    style={{ color: VERDICT_COLOR[String(verdict.value)] ?? "#94a3b8" }}
                  >
                    {verdict.value}
                  </span>
                  <span className="text-xs text-slate-400">{verdict.rule}</span>
                </>
              ) : (
                <span className="text-sm text-slate-500">{verdict.reason ?? "No verdict"}</span>
              )}
            </div>

            {/* Signal row */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiStat label="HRV" value={hrv.value} unit={hrv.unit} status={hrv.status} rule={hrv.rule} reason={hrv.reason} />
              <KpiStat label="RHR" value={rhr.value} unit={rhr.unit} status={rhr.status} rule={rhr.rule} reason={rhr.reason} />
              <KpiStat label="Sleep" value={slp.value} unit={slp.unit} status={slp.status} rule={slp.rule} reason={slp.reason} />
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/30 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Steps</div>
                <div className="mt-1 font-display text-xl font-semibold text-white">
                  {steps != null ? steps.toLocaleString("en-AU") : "–"}
                </div>
                {goal != null && steps != null && (
                  <div className="mt-1 text-[10px] text-slate-500">/ {goal.toLocaleString("en-AU")} goal</div>
                )}
              </div>
            </div>

            {/* Days since last session */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {(["swim", "bike", "run", "strength"] as const).map((sport) => {
                const d = daySince[sport];
                const icon = { swim: "🏊", bike: "🚴", run: "🏃", strength: "🏋️" }[sport];
                const color = d.status === "act" ? "#f87171" : d.status === "watch" ? "#fbbf24" : d.status === "na" ? "#334155" : "#64748b";
                return (
                  <span key={sport} className="text-[11px]" style={{ color }}>
                    {icon} {d.value != null ? `${d.value}d` : "–"}
                  </span>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function StepsCard({ now, prev, go }: {
  now: ReturnType<typeof stepStat>; prev: ReturnType<typeof stepStat>; go: (p: string) => void;
}) {
  const color = "#a3e635";
  const tiles = [
    { label: "Steps", value: fmtSteps(now.totalSteps), unit: "", d: pct(now.totalSteps, prev.totalSteps) },
    { label: "Avg/day", value: now.avgSteps?.toLocaleString("en-AU") ?? "–", unit: "", d: pct(now.avgSteps || 0, prev.avgSteps || 0) },
    { label: "Goal days", value: `${now.goalDays}/${now.totalDays}`, unit: "", d: pct(now.goalDays, prev.goalDays) },
  ];
  return (
    <button
      onClick={() => go("/activity/walking")}
      className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-left transition hover:border-slate-700 hover:bg-slate-900/70"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg text-xl" style={{ background: `${color}1a` }}>👟</span>
          <span className="font-display text-base font-semibold text-white">Steps</span>
        </div>
        <span className="text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-400">›</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label}>
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t.label}</div>
            <div className="mt-0.5 flex items-baseline gap-0.5">
              <span className="font-display text-xl font-semibold text-white" style={{ color }}>{t.value}</span>
            </div>
            <Delta delta={t.d} suffix="" />
          </div>
        ))}
      </div>
    </button>
  );
}

// ---- This week card (US-3) --------------------------------------------------

function ThisWeekCard({ data, today: todayDate }: { data: Bundle; today: Date }) {
  const weeks = useMemo(() => weeklySeries(data.activities, 52, todayDate), [data, todayDate]);
  const current = weeks.find((w) => w.inProgress);
  const hours = current ? +current.totalHours.toFixed(1) : 0;

  const streak = weeklyTrainingStreak(weeks, todayDate);
  const active = activeDaysYtd(data.activities, todayDate);
  const strength = strengthMobilityThisWeek(weeks, todayDate);
  const intensity = intensityMinutesThisWeek(data.daily, todayDate);
  const quality = qualitySessionsThisWeek(weeks, todayDate);

  const weekLabel = current ? `w/c ${current.weekStart.slice(5).replace("-", "/")}` : "";

  return (
    <div className="mb-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">This week</span>
          {weekLabel && <span className="text-xs text-slate-600">{weekLabel}</span>}
        </div>

        {/* Training quality row */}
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/30 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Hours</div>
            <div className="mt-1 font-display text-xl font-semibold text-white">{hours}</div>
            <div className="mt-1 text-[10px] text-slate-500">training so far</div>
          </div>
          <KpiStat label="Quality" value={quality.value} unit={quality.unit} status={quality.status} rule={quality.rule} reason={quality.reason} />
          <KpiStat label="Strength" value={strength.value} status={strength.status} rule={strength.rule} />
          <KpiStat label="Intensity" value={intensity.value} unit={intensity.unit} status={intensity.status} rule={intensity.rule} />
        </div>

        {/* Consistency row */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <KpiStat label="Streak" value={streak.value} unit={streak.unit} status={streak.status} rule={streak.rule} />
          <KpiStat label="Active days" value={active.thisWeek.value} unit={active.thisWeek.unit} status={active.thisWeek.status} rule={active.thisWeek.rule} />
          <KpiStat label="Active YTD" value={active.ytd.value} status={active.ytd.status} rule={active.ytd.rule} />
        </div>
      </Card>
    </div>
  );
}
