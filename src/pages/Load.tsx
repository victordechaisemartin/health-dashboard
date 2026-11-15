import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Bundle } from "../lib/data";
import { BUCKET_META, parseLocalDate, today, type PeriodKey } from "../lib/metrics";
import { AXIS_TICK, ChartCard, GRID, KpiStat, PageHeader, TOOLTIP } from "../ui";
import {
  acuteChronicRatio, hardDayStreak, longRunShare,
  qualitySessionsThisWeek, weeklyVolumeProgression,
} from "../lib/kpis";
import { classifySession, weeklySeries } from "../lib/weeks";
import { WEEKLY_VOLUME_LIMIT_PCT } from "../lib/targets";

const TRAINING_BUCKETS = ["cycling", "running", "swimming", "weights"] as const;

export default function Load({ data, refreshed }: {
  data: Bundle; refreshed?: string;
  // unused by this page but accepted for uniform prop shape
  now?: Date; period?: PeriodKey; setPeriod?: (p: PeriodKey) => void;
}) {
  const realToday = today();
  const weeks16 = useMemo(() => weeklySeries(data.activities, 16, realToday), [data, realToday]);
  const weeks12 = useMemo(() => weeklySeries(data.activities, 12, realToday), [data, realToday]);

  const acwr = useMemo(() => acuteChronicRatio(data.activities, data.daily, realToday), [data, realToday]);
  const volume = useMemo(() => weeklyVolumeProgression(weeks16, realToday), [weeks16, realToday]);
  const longRun = useMemo(() => longRunShare(weeks16, realToday), [weeks16, realToday]);
  const streak = useMemo(() => hardDayStreak(data.activities, realToday), [data, realToday]);
  const quality = useMemo(() => qualitySessionsThisWeek(weeks12, realToday), [weeks12, realToday]);

  // 12-week weekly ACWR approximation: acute = week load, chronic = rolling 4-week avg
  const acwrSeries = useMemo(() => {
    const ws = weeklySeries(data.activities, 16, realToday);
    return ws.slice(4).map((w, j) => {
      const i = j + 4;
      const chronic = ws.slice(i - 3, i + 1).reduce((s, wk) => s + wk.totalLoad, 0) / 4;
      return {
        label: w.weekStart.slice(5),
        ratio: chronic > 0 ? +(w.totalLoad / chronic).toFixed(2) : null,
      };
    });
  }, [data, realToday]);

  // 16-week stacked hours by bucket
  const hoursSeries = useMemo(() =>
    weeks16.map((w) => ({
      label: w.weekStart.slice(5),
      ...Object.fromEntries(TRAINING_BUCKETS.map((b) => [b, +w.byBucket[b].hours.toFixed(1)])),
    })),
    [weeks16]
  );

  // 16-week run km with +10% limit line
  const runKmSeries = useMemo(() => {
    const completed = weeks16.filter((w) => !w.inProgress);
    const baseKm = completed.length >= 5
      ? Math.max(...completed.slice(-5, -1).map((w) => w.byBucket.running.km))
      : null;
    const limit = baseKm != null ? +(baseKm * (1 + WEEKLY_VOLUME_LIMIT_PCT / 100)).toFixed(1) : null;
    return { series: weeks16.map((w) => ({ label: w.weekStart.slice(5), km: +w.byBucket.running.km.toFixed(1) })), limit };
  }, [weeks16]);

  // Last 14 days of training sessions
  const sessions14 = useMemo(() => {
    const cutoff = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate() - 13);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    return data.activities
      .filter((a) => a.activity_date >= cutoffStr)
      .sort((a, b) => b.activity_date.localeCompare(a.activity_date));
  }, [data, realToday]);

  return (
    <div>
      <PageHeader title="Load" icon="⚡" accent="#fbbf24" subtitle="Training load & ramp-rate safety" refreshed={refreshed} />

      {/* KPI row */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiStat label="ACWR" value={acwr.value} unit={acwr.unit} status={acwr.status} rule={acwr.rule} reason={acwr.reason} />
        <KpiStat label="Weekly hours" value={volume.hours.value} unit={volume.hours.unit} status={volume.hours.status} rule={volume.hours.rule} reason={volume.hours.reason} />
        <KpiStat label="Run km" value={volume.runKm.value} unit={volume.runKm.unit} status={volume.runKm.status} rule={volume.runKm.rule} reason={volume.runKm.reason} />
        <KpiStat label="Long-run share" value={longRun.value} status={longRun.status} rule={longRun.rule} reason={longRun.reason} />
        <KpiStat label="Hard-day streak" value={streak.value} status={streak.status} rule={streak.rule} reason={streak.reason} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-2">
        <KpiStat label="Quality sessions" value={quality.value} status={quality.status} rule={quality.rule} reason={quality.reason} />
      </div>

      {/* ACWR line chart with coloured bands */}
      <ChartCard title="Acute:chronic ratio (12 weeks)" subtitle="Weekly approximation · bands: grey detraining · green optimal · amber watch · red act">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={acwrSeries} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} stroke="#334155" />
            <YAxis tick={AXIS_TICK} stroke="#334155" domain={[0, 2]} tickFormatter={(v) => v.toFixed(1)} />
            <Tooltip {...TOOLTIP} formatter={(v) => [v, "ACWR"]} />
            {/* Band shading */}
            <ReferenceArea y1={0} y2={0.8} fill="#94a3b8" fillOpacity={0.07} />
            <ReferenceArea y1={0.8} y2={1.3} fill="#34d399" fillOpacity={0.07} />
            <ReferenceArea y1={1.3} y2={1.5} fill="#fbbf24" fillOpacity={0.09} />
            <ReferenceArea y1={1.5} y2={2} fill="#f87171" fillOpacity={0.09} />
            {/* Reference lines at band boundaries */}
            <ReferenceLine y={0.8} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
            <ReferenceLine y={1.3} stroke="#34d399" strokeDasharray="4 4" strokeWidth={1} />
            <ReferenceLine y={1.5} stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1} />
            <Line type="monotone" dataKey="ratio" stroke="#fbbf24" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* 16-week stacked hours */}
      <ChartCard className="mt-4" title="Training hours by activity (16 weeks)" subtitle="stacked hours per week">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={hoursSeries} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} stroke="#334155" />
            <YAxis tick={AXIS_TICK} stroke="#334155" unit="h" />
            <Tooltip {...TOOLTIP} />
            {TRAINING_BUCKETS.map((b) => (
              <Bar key={b} dataKey={b} stackId="h" fill={BUCKET_META[b].color} name={BUCKET_META[b].label} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* 16-week run km */}
      <ChartCard className="mt-4" title="Run km (16 weeks)" subtitle={`+${WEEKLY_VOLUME_LIMIT_PCT}% limit shown`}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={runKmSeries.series} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} stroke="#334155" />
            <YAxis tick={AXIS_TICK} stroke="#334155" unit="km" />
            <Tooltip {...TOOLTIP} />
            {runKmSeries.limit != null && (
              <ReferenceLine y={runKmSeries.limit} stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: `+${WEEKLY_VOLUME_LIMIT_PCT}%`, fill: "#fbbf24", fontSize: 10, position: "right" }} />
            )}
            <Bar dataKey="km" fill={BUCKET_META.running.color} name="Run km" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* 14-day session table */}
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-3 font-display text-base font-semibold text-white">Sessions — last 14 days</h2>
        {sessions14.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">No sessions in the last 14 days</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4 text-right">Duration</th>
                  <th className="pb-2 pr-4 text-right">Load</th>
                  <th className="pb-2 text-center">Q</th>
                  <th className="pb-2 pl-2 text-center">L</th>
                </tr>
              </thead>
              <tbody>
                {sessions14.map((a) => {
                  const { isQuality, isLong } = classifySession(a);
                  const dMin = a.duration_s != null ? Math.round(a.duration_s / 60) : null;
                  return (
                    <tr key={`${a.activity_date}-${a.activity_id}`} className="border-b border-slate-800/50 last:border-0">
                      <td className="py-2 pr-4 text-slate-400">
                        {parseLocalDate(a.activity_date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
                      </td>
                      <td className="py-2 pr-4 capitalize text-slate-300">{(a.activity_type ?? "unknown").replace(/_/g, " ")}</td>
                      <td className="py-2 pr-4 text-right text-slate-400">{dMin != null ? `${dMin} min` : "–"}</td>
                      <td className="py-2 pr-4 text-right text-slate-400">{a.training_load ?? "–"}</td>
                      <td className="py-2 text-center">
                        {isQuality ? <span className="font-semibold text-amber-400">Q</span> : <span className="text-slate-700">·</span>}
                      </td>
                      <td className="py-2 pl-2 text-center">
                        {isLong ? <span className="font-semibold text-sky-400">L</span> : <span className="text-slate-700">·</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
