// POST { password } -> sets an httpOnly session cookie when the password matches
// GH_PASSWORD. GH_PASSWORD is required on Vercel (api/data refuses to serve
// without it). The password + session token live server-side only.
import crypto from "node:crypto";
import { gateMissing } from "./_bundle.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }
  if (!process.env.GH_PASSWORD) {
    res.status(200).json({ ok: true, open: true });
    return;
  }
  const missing = gateMissing();
  if (missing.length) {
    res.status(503).json({ error: "not_configured", missing });
    return;
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const password = String((body && body.password) || "");
  const a = crypto.createHash("sha256").update(process.env.GH_PASSWORD).digest();
  const b = crypto.createHash("sha256").update(password).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    // Serverless functions share no memory across invocations, so a per-instance
    // counter is useless. A flat 1s delay keeps online brute force miserable.
    await new Promise((r) => setTimeout(r, 1000));
    res.status(401).json({ ok: false });
    return;
  }
  const token = process.env.GH_SESSION_TOKEN;
  res.setHeader(
    "Set-Cookie",
    `gh_auth=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
  );
  res.status(200).json({ ok: true });
}
