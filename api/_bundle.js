// Shared by /api/data.
//
// Reads your Supabase tables server-side with the secret key; the key never
// reaches the browser. There is no sample/fallback path — if config is
// missing, loadBundle() throws NotConfiguredError and the route surfaces it
// so the UI can show a setup screen.
//
// Optional password gate: set GH_PASSWORD (and GH_SESSION_TOKEN) and every
// data route requires the session cookie that /api/login sets. On Vercel the
// gate is required (api/data.js refuses to serve without it).

import crypto from "node:crypto";

// A gate with a weak cookie value is theatre. 32 chars of entropy is the floor;
// anything shorter is treated as unconfigured so the Setup screen surfaces it.
export const MIN_SESSION_TOKEN_LEN = 32;

export class NotConfiguredError extends Error {
  constructor(missing) {
    super("not_configured");
    this.missing = missing;
  }
}

export const isGated = () => !!process.env.GH_PASSWORD;

/** Gate-only validation (session cookie strength). Used by /api/login too. */
export function gateMissing() {
  if (!isGated()) return [];
  const tok = process.env.GH_SESSION_TOKEN;
  if (!tok || tok.length < MIN_SESSION_TOKEN_LEN) return ["GH_SESSION_TOKEN"];
  return [];
}

/** Every env var missing to run live (Supabase + gate). */
export function missingConfig() {
  const missing = [];
  if (!process.env.GARMIN_SUPABASE_URL) missing.push("GARMIN_SUPABASE_URL");
  if (!process.env.GARMIN_SUPABASE_SECRET_KEY) missing.push("GARMIN_SUPABASE_SECRET_KEY");
  return [...missing, ...gateMissing()];
}

/** true when the request may read data (no gate, or a valid session cookie). */
export function authorised(req) {
  if (!isGated()) return true;
  const token = process.env.GH_SESSION_TOKEN;
  if (!token || token.length < MIN_SESSION_TOKEN_LEN) return false;
  const cookies = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .reduce((acc, s) => {
      const i = s.indexOf("=");
      if (i > 0) acc[s.slice(0, i)] = s.slice(i + 1);
      return acc;
    }, {});
  const got = cookies.gh_auth || "";
  if (!got) return false;
  // Cookie and token can differ in length; hashing both to a 32-byte digest
  // lets timingSafeEqual do a true constant-time compare.
  const a = crypto.createHash("sha256").update(token).digest();
  const b = crypto.createHash("sha256").update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

// Supabase/PostgREST caps a single response at 1000 rows (the `limit` param
// can't raise it). daily_summary passes 1000 rows within three years, and an
// unpaginated read silently drops the newest rows, so page with Range headers.
const PAGE = 1000;
async function sbGet(table, order) {
  const url = process.env.GARMIN_SUPABASE_URL;
  const key = process.env.GARMIN_SUPABASE_SECRET_KEY;
  // sb_secret_* keys bypass RLS via `apikey` alone; no Authorization header needed.
  const headers = { apikey: key };
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${url}/rest/v1/${table}?select=*&order=${order}`, {
      headers: { ...headers, "Range-Unit": "items", Range: `${from}-${from + PAGE - 1}` },
    });
    if (!r.ok) throw new Error(`${table}: ${r.status}`);
    const batch = await r.json();
    all.push(...batch);
    if (batch.length < PAGE) return all;
  }
}

async function sbLatestSync() {
  const url = process.env.GARMIN_SUPABASE_URL;
  const key = process.env.GARMIN_SUPABASE_SECRET_KEY;
  const r = await fetch(`${url}/rest/v1/garmin_sync_runs?select=*&order=run_at.desc&limit=1`, {
    headers: { apikey: key },
  });
  if (!r.ok) throw new Error(`garmin_sync_runs: ${r.status}`);
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function loadBundle() {
  const missing = missingConfig();
  if (missing.length) throw new NotConfiguredError(missing);
  const [weighIns, activities, sleep, daily, dexa, bloods, hrv, lastSync] = await Promise.all([
    sbGet("garmin_weigh_ins", "measured_date.asc"),
    sbGet("garmin_activities", "activity_date.asc"),
    sbGet("garmin_sleep", "sleep_date.asc"),
    sbGet("garmin_daily_summary", "summary_date.asc"),
    // Optional side-tables: absent until you run their migrations, and that
    // must not take the whole dashboard down.
    sbGet("dexa_scans", "scan_date.asc").catch(() => []),
    sbGet("blood_panels", "panel_date.asc").catch(() => []),
    sbGet("garmin_hrv", "hrv_date.asc").catch(() => []),
    sbLatestSync().catch(() => null),
  ]);
  return { weighIns, activities, sleep, daily, dexa, bloods, hrv, lastSync, source: "supabase" };
}
