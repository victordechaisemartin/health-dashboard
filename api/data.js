// Data proxy. Returns the dashboard bundle (weigh-ins, activities, sleep,
// daily, DEXA, bloods) from Supabase. The Supabase key only ever lives here,
// server-side.
//
// Guards:
//   1. On Vercel, GH_PASSWORD must be set or the route refuses to serve
//      (production must never be open).
//   2. If Supabase env vars are missing, returns 503 { error: "not_configured" }
//      so the UI can render a setup screen (never fake data).
//   3. With GH_PASSWORD set, 401 until /api/login has set the session cookie.
import { authorised, isGated, loadBundle, missingConfig, NotConfiguredError } from "./_bundle.js";

export default async function handler(req, res) {
  if (process.env.VERCEL && !isGated()) {
    res.status(401).json({ error: "unprotected", detail: "Set GH_PASSWORD on the deployment." });
    return;
  }
  const missing = missingConfig();
  if (missing.length) {
    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({ error: "not_configured", missing });
    return;
  }
  if (!authorised(req)) {
    res.status(401).json({ error: "auth" });
    return;
  }
  try {
    const bundle = await loadBundle();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(bundle);
  } catch (e) {
    if (e instanceof NotConfiguredError) {
      res.status(503).json({ error: "not_configured", missing: e.missing });
      return;
    }
    res.status(502).json({ error: "upstream", detail: String(e) });
  }
}
