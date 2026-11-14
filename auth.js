// /api/auth — password setup, login, and change (admin device only).
import { sbInsert, sbUpdate } from "./_lib.js";
import { getAuthRow, clearAuthCache, hashPassword, sha256, randomHex, safeEqual, makeToken, checkToken } from "./_auth.js";

const slow = () => new Promise(r => setTimeout(r, 700)); // slows down password guessing

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(200).json({ error: "Server is missing SUPABASE_URL / SUPABASE_SERVICE_KEY." });
  }
  const b = req.body || {};
  const action = b.action;

  try {
    const row = await getAuthRow(true);

    // has a password been set yet? is this browser logged in? is it the admin device?
    if (action === "status") {
      if (!row) return res.status(200).json({ configured: false });
      return res.status(200).json({
        configured: true,
        loggedIn: checkToken(b.token, row.secret),
        isAdmin: !!b.adminToken && safeEqual(sha256(b.adminToken), row.admin_hash)
      });
    }

    // first-time setup: only works while no password exists
    if (action === "setup") {
      if (row) return res.status(200).json({ error: "Password is already set." });
      const pw = String(b.password || "");
      if (pw.length < 6) return res.status(200).json({ error: "Password must be at least 6 characters." });
      const salt = randomHex(16), secret = randomHex(32), adminToken = randomHex(32);
      try {
        await sbInsert("app_auth", [{ id: 1, pass_hash: hashPassword(pw, salt), salt, admin_hash: sha256(adminToken), secret }]);
      } catch (e) {
        if (/duplicate|unique/i.test(e.message)) return res.status(200).json({ error: "Password is already set." });
        throw e;
      }
      clearAuthCache();
      return res.status(200).json({ ok: true, token: makeToken(secret), adminToken });
    }

    if (!row) return res.status(200).json({ error: "No password set yet.", configured: false });

    if (action === "login") {
      if (!safeEqual(hashPassword(b.password || "", row.salt), row.pass_hash)) {
        await slow();
        return res.status(200).json({ error: "Wrong password." });
      }
      return res.status(200).json({ ok: true, token: makeToken(row.secret) });
    }

    // change password: only from the device that set it up (holds the admin token)
    if (action === "change") {
      if (!b.adminToken || !safeEqual(sha256(b.adminToken), row.admin_hash)) {
        await slow();
        return res.status(200).json({ error: "Password can only be changed from the computer where it was first set up." });
      }
      if (!safeEqual(hashPassword(b.oldPassword || "", row.salt), row.pass_hash)) {
        await slow();
        return res.status(200).json({ error: "Current password is wrong." });
      }
      const pw = String(b.newPassword || "");
      if (pw.length < 6) return res.status(200).json({ error: "New password must be at least 6 characters." });
      const salt = randomHex(16), secret = randomHex(32);
      await sbUpdate("app_auth?id=eq.1", { pass_hash: hashPassword(pw, salt), salt, secret, updated_at: new Date().toISOString() });
      clearAuthCache();
      return res.status(200).json({ ok: true, token: makeToken(secret) });
    }

    return res.status(200).json({ error: "Unknown action" });
  } catch (e) {
    const msg = /issued at future/i.test(e.message)
      ? "Supabase is not accepting the key right now (its clock is behind — JWT issued at future). Wait a few minutes and retry, or restart the Supabase project: Settings → General → Restart project."
      : /app_auth/.test(e.message) || /relation|schema cache/i.test(e.message)
      ? "The app_auth table is missing in Supabase. Run the SQL from SETUP-PASSWORD.md once."
      : e.message;
    return res.status(200).json({ error: msg });
  }
}
