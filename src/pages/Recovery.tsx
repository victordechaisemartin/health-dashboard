import { useMemo } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart,
  ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Bundle } from "../lib/data";
import { fmtDate } from "../lib/data";
import { parseLocalDate, periods, sleepStat, sleepScoreOf, pct, today, type PeriodKey, type Window } from "../lib/metrics";
import { AXIS_TICK, ChartCard, EmptyHint, GRID, PageHeader, PeriodMenu, Stat, TOOLTIP } from "../ui";

const ACCENT = "#38bdf8";
const C = { rhr: "#f87171", score: "#fbbf24", stress: "#fb923c", resp: "#6ee7b7", load: "#a78bfa" };
const HRV_DOT_COLOR: Record<string, string> = {
  BALANCED: "#34d399", UNBALANCED: "#fbbf24", LOW: "#f87171", NO_STATUS: "#64748b",
};

const inWin = (date: string, w: Window) => {
  const t = parseLocalDate(date).getTime();
  return t >= w.start.getTime() && t <= w.end.getTime();
};
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export default function Recovery({ data, now, period, setPeriod, refreshed }: {
  data: Bundle; now: Date; period: PeriodKey; setPeriod: (p: PeriodKey) => void; refreshed?: string;
}) {
  const { current, prev } = periods(now, period);
  const realToday = today();
  const lstr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = lstr(realToday);
  const cutoff30 = lstr(new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate() - 29));

  const daily = useMemo(
    () => [...data.daily].sort((a, b) => a.summary_date.localeCompare(b.summary_date)),
    [data]
  );
  const sleep = useMemo(
    () => [...data.sleep].sort((a, b) => a.sleep_date.localeCompare(b.sleep_date)),
    [data]
  );

  // ---- window aggregates (all from real fields) ----
  const stats = useMemo(() => {
    const agg = (w: Window) => {
      const d = daily.filter((r) => inWin(r.summary_date, w));
      const s = sleep.filter((r) => inWin(r.sleep_date, w));
      const acts = data.activities.filter((a) => inWin(a.activity_date, w));
      const rhr = mean(d.map((r) => r.resting_hr).filter((v): v is number => v != null));
      const stress = mean(s.map((r) => r.avg_stress).filter((v): v is number => v != null));
      const resp = mean(s.map((r) => r.avg_respiration).filter((v): v is number => v != null));
      const load = acts.reduce((a, r) => a + (r.training_load || 0), 0);
      const sl = sleepStat(s);
      return { rhr, stress, resp, load, score: sl.avgScore, hours: sl.avgHours, nDaily: d.length, nSleep: s.length };
    };
    return { cur: agg(current), pre: agg(prev) };
  }, [daily, sleep, data, current, prev]);
  const { cur, pre } = stats;

  // ---- chart series (current window) ----
  const rhrSeries = useMemo(
    () => daily.filter((d) => inWin(d.summary_date, current) && d.resting_hr != null)
      .map((d) => ({ date: fmtDate(d.summary_date), rhr: d.resting_hr })),
    [daily, current]
  );
  const scoreSeries = useMemo(
    () => sleep.filter((s) => inWin(s.sleep_date, current))
      .map((s) => ({ date: fmtDate(s.sleep_date), score: sleepScoreOf(s), stress: s.avg_stress ?? null }))
      .filter((r) => r.score != null || r.stress != null),
    [sleep, current]
  );
  const loadSeries = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const a of data.activities) {
      if (!inWin(a.activity_date, current) || !a.training_load) continue;
      const key = a.activity_date.slice(0, 10);
      byDay.set(key, (byDay.get(key) || 0) + a.training_load);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([d, load]) => ({ date: fmtDate(d), load: Math.round(load) }));
  }, [data, current]);

  // ---- HRV series (last 30 nights, colored by Garmin status) ----
  const hrvSeries = useMemo(() =>
    [...data.hrv]
      .filter((h) => h.hrv_date >= cutoff30 && h.hrv_date <= todayStr && h.last_night_avg != null)
      .sort((a, b) => a.hrv_date.localeCompare(b.hrv_date))
      .map((h) => ({
        date: fmtDate(h.hrv_date),
        hrv: h.last_night_avg,
        status: h.status ?? "NO_STATUS",
        fill: HRV_DOT_COLOR[h.status ?? "NO_STATUS"] ?? "#64748b",
      })),
    [data, cutoff30, todayStr]
  );

  // Most-recent Garmin baseline band (baseline_low / baseline_high)
  const hrvBand = useMemo(() => {
    const rows = data.hrv.filter((h) => h.baseline_low != null && h.baseline_high != null);
    if (!rows.length) return null;
    rows.sort((a, b) => a.hrv_date.localeCompare(b.hrv_date));
    const last = rows[rows.length - 1];
    return { low: last.baseline_low!, high: last.baseline_high! };
  }, [data]);

  // 30-day mean RHR (excludes today; shown as baseline on the RHR chart)
  const rhrBaselineMean = useMemo(() => {
    const yesterdayStr = lstr(new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate() - 1));
    const vals = daily
      .filter((d) => d.summary_date >= cutoff30 && d.summary_date <= yesterdayStr && d.resting_hr != null)
      .map((d) => d.resting_hr as number);
    return vals.length >= 7 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [daily, cutoff30, realToday]);

  if (!daily.length && !sleep.length) {
    return (
      <div>
        <PageHeader title="Recovery" icon="🌙" accent={ACCENT} subtitle="No recovery data yet" refreshed={refreshed} />
        <EmptyHint>No daily or sleep data in this dataset.</EmptyHint>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Recovery"
        icon="🌙"
        accent={ACCENT}
        subtitle={`Resting HR · sleep · stress · load — ${current.label} vs ${prev.label}`}
        refreshed={refreshed}
        right={<PeriodMenu value={period} onChange={setPeriod} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Resting HR" value={cur.rhr != null ? Math.round(cur.rhr) : "–"} unit="bpm" color={C.rhr}
          delta={pct(cur.rhr || 0, pre.rhr || 0)} deltaGood={false} />
        <Stat label="Sleep score" value={cur.score ?? "–"} color={C.score}
          delta={pct(cur.score || 0, pre.score || 0)} deltaGood />
        <Stat label="Sleep hours" value={cur.hours ?? "–"} unit="h" color={ACCENT}
          delta={pct(cur.hours || 0, pre.hours || 0)} deltaGood />
        <Stat label="Avg stress" value={cur.stress != null ? Math.round(cur.stress) : "–"} color={C.stress}
          delta={pct(cur.stress || 0, pre.stress || 0)} deltaGood={false} />
        <Stat label="Avg respiration" value={cur.resp != null ? +cur.resp.toFixed(1) : "–"} unit="brpm" color={C.resp}
          delta={pct(cur.resp || 0, pre.resp || 0)} deltaGood={false} />
        <Stat label="Training load" value={Math.round(cur.load)} color={C.load}
          delta={pct(cur.load, pre.load)} deltaGood />
      </div>

      <ChartCard title="Resting heart rate" subtitle={`daily · ${current.label} · lower is better`} className="mb-4">
        {rhrSeries.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={rhrSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="grhr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.rhr} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={C.rhr} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="date" tick={AXIS_TICK} stroke="#334155" minTickGap={24} />
              <YAxis domain={["dataMin - 2", "dataMax + 2"]} tickFormatter={(v) => `${Math.round(v)}`} tick={AXIS_TICK} stroke="#334155" unit="bpm" width={56} />
              <Tooltip {...TOOLTIP} />
              <Area type="monotone" dataKey="rhr" stroke={C.rhr} strokeWidth={2} fill="url(#grhr)" dot={false} name="Resting HR" connectNulls isAnimationActive={false} />
              {rhrBaselineMean != null && (
                <ReferenceLine y={rhrBaselineMean} stroke={C.rhr} strokeDasharray="4 4" strokeOpacity={0.5}
                  label={{ value: `${rhrBaselineMean} avg`, fill: C.rhr, fontSize: 10, position: "right" }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyHint>No resting HR data in this window.</EmptyHint>
        )}
      </ChartCard>

      <ChartCard title="HRV last 30 nights" subtitle="last_night_avg · dot colour: green=balanced · amber=unbalanced · red=low" className="mb-4">
        {hrvSeries.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={hrvSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="date" tick={AXIS_TICK} stroke="#334155" minTickGap={24} />
              <YAxis domain={["dataMin - 5", "dataMax + 5"]} tick={AXIS_TICK} stroke="#334155" unit="ms" width={48} />
              <Tooltip {...TOOLTIP} />
              {hrvBand && (
                <ReferenceArea y1={hrvBand.low} y2={hrvBand.high} fill="#34d399" fillOpacity={0.07}
                  label={{ value: `${hrvBand.low}–${hrvBand.high}`, fill: "#34d399", fontSize: 10, position: "insideTopRight" }} />
              )}
              <Line type="monotone" dataKey="hrv" stroke="#64748b" strokeWidth={1.5} name="HRV"
                dot={(props: any) => {
                  if (props.cx == null || props.cy == null) return <g key={props.index} />;
                  return <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill={props.payload?.fill ?? "#64748b"} stroke="none" />;
                }}
                activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyHint>No HRV data in the last 30 days.</EmptyHint>
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Sleep score" subtitle={`nightly · ${current.label}`}>
          {scoreSeries.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={scoreSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" tick={AXIS_TICK} stroke="#334155" minTickGap={24} />
                <YAxis domain={[0, 100]} tick={AXIS_TICK} stroke="#334155" width={36} />
                <Tooltip {...TOOLTIP} />
                <Line type="monotone" dataKey="score" stroke={C.score} strokeWidth={2} dot={false} name="Sleep score" connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyHint>No sleep data in this window.</EmptyHint>
          )}
        </ChartCard>

        <ChartCard title="Daily training load" subtitle={`sum per day · ${current.label}`}>
          {loadSeries.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={loadSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} stroke="#334155" minTickGap={24} />
                <YAxis tick={AXIS_TICK} stroke="#334155" width={40} />
                <Tooltip {...TOOLTIP} />
                <Bar dataKey="load" fill={C.load} radius={[3, 3, 0, 0]} name="Load" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyHint>No training load in this window.</EmptyHint>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
