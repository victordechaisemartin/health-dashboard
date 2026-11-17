// POST -> clears the gh_auth cookie. Nothing to validate: expiring a session
// is always safe for the owner of the browser holding it.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }
  res.setHeader(
    "Set-Cookie",
    "gh_auth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  );
  res.status(200).json({ ok: true });
}
