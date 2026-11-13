// Shared by /api/data and /api/chat.
//
// Reads your Supabase tables server-side with the secret key; the key never
// reaches the browser. There is no sample/fallback path — if config is
// missing, loadBundle() throws NotConfiguredError and the route surfaces it
// so the UI can show a setup screen.
//
// Optional password gate: set GH_PASSWORD (and GH_SESSION_TOKEN) and every
// data route requires the session cookie that /api/login sets. On Vercel the
// gate is required (api/data.js refuses to serve without it).

export class NotConfiguredError extends Error {
  constructor(missing) {
    super("not_configured");
    this.missing = missing;
  }
}

export const isGated = () => !!process.env.GH_PASSWORD;

/** Env vars missing to run live. */
export function missingConfig() {
  const missing = [];
  if (!process.env.GARMIN_SUPABASE_URL) missing.push("GARMIN_SUPABASE_URL");
  if (!process.env.GARMIN_SUPABASE_SECRET_KEY) missing.push("GARMIN_SUPABASE_SECRET_KEY");
  return missing;
}

/** true when the request may read data (no gate, or a valid session cookie). */
export function authorised(req) {
  if (!isGated()) return true;
  const token = process.env.GH_SESSION_TOKEN || "ok";
  const cookies = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .reduce((acc, s) => {
      const i = s.indexOf("=");
      if (i > 0) acc[s.slice(0, i)] = s.slice(i + 1);
      return acc;
    }, {});
  return cookies.gh_auth === token;
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

export async function loadBundle() {
  const missing = missingConfig();
  if (missing.length) throw new NotConfiguredError(missing);
  const [weighIns, activities, sleep, daily, dexa, bloods] = await Promise.all([
    sbGet("garmin_weigh_ins", "measured_date.asc"),
    sbGet("garmin_activities", "activity_date.asc"),
    sbGet("garmin_sleep", "sleep_date.asc"),
    sbGet("garmin_daily_summary", "summary_date.asc"),
    // Optional side-tables: absent until you run their migrations, and that
    // must not take the whole dashboard down.
    sbGet("dexa_scans", "scan_date.asc").catch(() => []),
    sbGet("blood_panels", "panel_date.asc").catch(() => []),
  ]);
  return { weighIns, activities, sleep, daily, dexa, bloods, source: "supabase" };
}
