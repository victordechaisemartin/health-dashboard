// KPI functions — pure, no side-effects, no React imports.
// Constitution VI: `reason` MUST be set whenever `value === null` or `status === "na"`.
// Constitution VIII: all thresholds come from targets.ts, never inline.

export type KpiStatus = "ok" | "watch" | "act" | "na";

export type KpiResult = {
  value: number | string | null;
  unit?: string;
  target?: number | string;
  status: KpiStatus;
  rule: string;
  reason?: string;
};
