import { useMemo } from "react";
import {
  Area, AreaChart, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Bundle } from "../lib/data";
import { fmtDate } from "../lib/data";
import { BUCKET_META, periods, sleepStat, sleepScoreOf, pct, today, type PeriodKey } from "../lib/metrics";
import { AXIS_TICK, ChartCard, EmptyHint, GRID, KpiStat, PageHeader, PeriodMenu, Stat, TOOLTIP } from "../ui";
import { sleepRolling7d, bedtimeConsistency } from "../lib/kpis";

const STAGE = { deep: "#6366f1", light: "#818cf8", rem: "#22d3ee", awake: "#475569" };

/** Convert UTC ISO to minutes-from-18:00 in Europe/Paris, wrapping past midnight (§6/8). */
function toParisMin(isoUtc: string): number | null {
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const totalMin = h * 60 + m;
  return totalMin >= 18 * 60 ? totalMin - 18 * 60 : totalMin + 6 * 60;
}

function minsToHHMM(m: number): string {
  const totalMin = Math.round(m + 18 * 60) % (24 * 60);
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

export default function SleepPage({ data, now, period, setPeriod, refreshed }: {
  data: Bundle; now: Date; period: PeriodKey; setPeriod: (p: PeriodKey) => void; refreshed?: string;
}) {
  const m = BUCKET_META.sleep;
  const sleep = useMemo(() => [...data.sleep].sort((a, b) => a.sleep_date.localeCompare(b.sleep_date)), [data]);
  const { current, prev } = periods(now, period);
  const cur = sleepStat(sleep, current);
  const pre = sleepStat(sleep, prev);
  const realToday = today();

  const series = useMemo(() => {
    const last60 = sleep.slice(-60);
    return last60.map((s, i) => {
      const win = last60.slice(Math.max(0, i - 6), i + 1).filter((x) => x.total_sleep_s != null);
      const roll7 = win.length >= 3
        ? +(win.reduce((a, x) => a + x.total_sleep_s!, 0) / win.length / 3600).toFixed(2)
        : null;
      return {
        date: fmtDate(s.sleep_date),
        hours: s.total_sleep_s ? +(s.total_sleep_s / 3600).toFixed(1) : null,
        score: sleepScoreOf(s),
        deep: s.deep_s ? +(s.deep_s / 3600).toFixed(2) : 0,
        light: s.light_s ? +(s.light_s / 3600).toFixed(2) : 0,
        rem: s.rem_s ? +(s.rem_s / 3600).toFixed(2) : 0,
        awake: s.awake_s ? +(s.awake_s / 3600).toFixed(2) : 0,
        roll7,
      };
    });
  }, [sleep]);

  const bedtimeSeries = useMemo(() => {
    const lstr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const todayStr = lstr(realToday);
    const cutoffStr = lstr(new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate() - 29));
    return sleep
      .filter((s) => s.sleep_date >= cutoffStr && s.sleep_date <= todayStr && s.started_at != null)
      .map((s) => ({
        date: fmtDate(s.sleep_date),
        bedMin: toParisMin(s.started_at!),
        wakeMin: s.ended_at ? toParisMin(s.ended_at) : null,
      }))
      .filter((r) => r.bedMin != null);
  }, [sleep, realToday]);

  const sleepRoll = sleepRolling7d(sleep, realToday);
  const bedConsistency = bedtimeConsistency(sleep, realToday);

  if (!sleep.length) {
    return (
      <div>
        <PageHeader title="Sleep" icon={m.icon} accent={m.color} subtitle="No sleep nights recorded yet" refreshed={refreshed} />
        <EmptyHint>No sleep data in this dataset.</EmptyHint>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Sleep" icon={m.icon} accent={m.color} subtitle={`${sleep.length} nights tracked · ${current.label} vs ${prev.label}`} refreshed={refreshed} right={<PeriodMenu value={period} onChange={setPeriod} />} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Avg score" value={cur.avgScore ?? "–"} color={m.color} delta={pct(cur.avgScore || 0, pre.avgScore || 0)} deltaGood />
        <Stat label="Avg hours" value={cur.avgHours ?? "–"} unit="h" color={m.color} delta={pct(cur.avgHours || 0, pre.avgHours || 0)} deltaGood />
        <Stat label="Avg deep" value={cur.avgDeepPct ?? "–"} unit="%" color={STAGE.deep} delta={pct(cur.avgDeepPct || 0, pre.avgDeepPct || 0)} deltaGood />
        <Stat label="Avg REM" value={cur.avgRemPct ?? "–"} unit="%" color={STAGE.rem} delta={pct(cur.avgRemPct || 0, pre.avgRemPct || 0)} deltaGood />
        <Stat label="Nights" value={cur.nights} color={m.color} delta={pct(cur.nights, pre.nights)} deltaGood />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
        <KpiStat label="7d avg" value={sleepRoll.value} unit={sleepRoll.unit} status={sleepRoll.status} rule={sleepRoll.rule} reason={sleepRoll.reason} />
        <KpiStat label="Bedtime consistency" value={bedConsistency.value} unit={bedConsistency.unit} status={bedConsistency.status} rule={bedConsistency.rule} reason={bedConsistency.reason} />
      </div>

      <ChartCard title="Sleep hours & score" subtitle="last 60 nights · score derived from sleep stages where Garmin's own isn't recorded" className="mb-4">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="gsl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={m.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={m.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" tick={AXIS_TICK} stroke="#334155" minTickGap={24} />
            <YAxis yAxisId="l" tick={AXIS_TICK} stroke="#334155" unit="h" width={42} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={AXIS_TICK} stroke="#334155" width={32} />
            <Tooltip {...TOOLTIP} />
            <Area yAxisId="l" type="monotone" dataKey="hours" stroke={m.color} strokeWidth={2} fill="url(#gsl)" name="Hours" connectNulls isAnimationActive={false} />
            <Line yAxisId="l" type="monotone" dataKey="roll7" stroke="#fb923c" strokeWidth={2} strokeDasharray="6 3" dot={false} name="7d avg" connectNulls isAnimationActive={false} />
            <Line yAxisId="r" type="monotone" dataKey="score" stroke="#fbbf24" strokeWidth={1.5} dot={false} name="Score" connectNulls isAnimationActive={false} />
            <ReferenceLine yAxisId="l" y={7.5} stroke="#34d399" strokeDasharray="4 4" strokeWidth={1} label={{ value: "7.5h", fill: "#34d399", fontSize: 9, position: "right" }} />
            <ReferenceLine yAxisId="l" y={7} stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1} label={{ value: "7h", fill: "#fbbf24", fontSize: 9, position: "right" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Bedtime & wake times" subtitle="last 30 nights · reference lines: 22:30 target bed · 06:00 target wake" className="mb-4">
        {bedtimeSeries.length ? (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={bedtimeSeries} margin={{ top: 8, right: 48, left: -16, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="date" tick={AXIS_TICK} stroke="#334155" minTickGap={24} />
              <YAxis
                domain={[180, 810]}
                ticks={[180, 270, 360, 450, 540, 660, 780]}
                tickFormatter={minsToHHMM}
                tick={AXIS_TICK} stroke="#334155" width={42}
              />
              <Tooltip {...TOOLTIP} formatter={(v: number) => [minsToHHMM(v), ""]} />
              <ReferenceLine y={270} stroke="#818cf8" strokeDasharray="4 4" strokeWidth={1}
                label={{ value: "22:30", fill: "#818cf8", fontSize: 9, position: "right" }} />
              <ReferenceLine y={720} stroke="#34d399" strokeDasharray="4 4" strokeWidth={1}
                label={{ value: "06:00", fill: "#34d399", fontSize: 9, position: "right" }} />
              <Line type="monotone" dataKey="bedMin" stroke="#818cf8" strokeWidth={0}
                dot={{ fill: "#818cf8", r: 4, strokeWidth: 0 }} activeDot={{ r: 5 }}
                name="Bedtime" connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="wakeMin" stroke="#34d399" strokeWidth={0}
                dot={{ fill: "#34d399", r: 4, strokeWidth: 0 }} activeDot={{ r: 5 }}
                name="Wake" connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyHint>No bedtime data in the last 30 nights.</EmptyHint>
        )}
      </ChartCard>

      <ChartCard title="Sleep stages" subtitle="hours by stage · last 60 nights">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} stackOffset="none">
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="date" tick={AXIS_TICK} stroke="#334155" minTickGap={24} />
            <YAxis tick={AXIS_TICK} stroke="#334155" unit="h" width={42} />
            <Tooltip {...TOOLTIP} />
            <Area type="monotone" dataKey="deep" stackId="s" stroke={STAGE.deep} fill={STAGE.deep} fillOpacity={0.75} name="Deep" isAnimationActive={false} />
            <Area type="monotone" dataKey="light" stackId="s" stroke={STAGE.light} fill={STAGE.light} fillOpacity={0.55} name="Light" isAnimationActive={false} />
            <Area type="monotone" dataKey="rem" stackId="s" stroke={STAGE.rem} fill={STAGE.rem} fillOpacity={0.6} name="REM" isAnimationActive={false} />
            <Area type="monotone" dataKey="awake" stackId="s" stroke={STAGE.awake} fill={STAGE.awake} fillOpacity={0.5} name="Awake" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
