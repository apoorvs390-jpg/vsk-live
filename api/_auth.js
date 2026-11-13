// Password protection helpers. The password lives (hashed) in the Supabase
// table `app_auth` (one row, id = 1). See SETUP-PASSWORD.md.
import crypto from "crypto";
import { sbSelect } from "./_lib.js";

const TOKEN_DAYS = 30;
let cache = { row: undefined, at: 0 };

export async function getAuthRow(fresh = false) {
  if (!fresh && cache.row !== undefined && Date.now() - cache.at < 30000) return cache.row;
  const rows = await sbSelect("app_auth?id=eq.1&select=*");
  cache = { row: (rows && rows[0]) || null, at: Date.now() };
  return cache.row;
}
export function clearAuthCache() { cache = { row: undefined, at: 0 }; }

export function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}
export function sha256(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }
export function randomHex(n = 32) { return crypto.randomBytes(n).toString("hex"); }

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// token = "<expiry>.<signature>" signed with the row's secret.
// Changing the password changes the secret, so all old logins stop working.
export function makeToken(secret) {
  const exp = Date.now() + TOKEN_DAYS * 864e5;
  const sig = crypto.createHmac("sha256", secret).update(String(exp)).digest("hex");
  return `${exp}.${sig}`;
}
export function checkToken(token, secret) {
  if (!token || !secret) return false;
  const [exp, sig] = String(token).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = crypto.createHmac("sha256", secret).update(exp).digest("hex");
  return safeEqual(sig, good);
}

// Call at the top of every protected API. Returns true if the request may proceed.
export async function requireAuth(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(500).json({ error: { message: "Password lock needs SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel." }, authError: true });
    return false;
  }
  try {
    const row = await getAuthRow();
    const token = req.headers["x-vsk-token"];
    if (row && checkToken(token, row.secret)) return true;
    // retry once with fresh data (password may have just been changed elsewhere)
    const fresh = await getAuthRow(true);
    if (fresh && checkToken(token, fresh.secret)) return true;
  } catch (e) {
    res.status(500).json({ error: { message: "Password check failed: " + e.message }, authError: true });
    return false;
  }
  res.status(401).json({ error: { message: "Password required" }, authRequired: true });
  return false;
}
