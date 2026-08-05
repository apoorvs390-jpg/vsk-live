// Shared helpers for embeddings (Gemini) and Supabase REST access.

export const GEMINI_KEY = process.env.GEMINI_API_KEY;
export const SUPABASE_URL = process.env.SUPABASE_URL;          // e.g. https://xxxx.supabase.co
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;  // service_role key (server-side only)

// Embed a piece of text with Google's free text-embedding-004 (768 dims).
// Retries a few times on transient rate-limit / overload so per-minute spikes
// don't fail the whole book. A hard daily-quota error is surfaced to the caller.
export async function embed(text, tries = 4) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_KEY}`;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: (text || "").slice(0, 8000) }] }
      })
    });
    const data = await r.json();
    if (r.ok && data.embedding) return data.embedding.values;
    const msg = (data.error && data.error.message) || "embedding failed";
    lastErr = new Error(msg); lastErr.status = r.status;
    // 429/503 = transient: wait and retry. Other errors: fail immediately.
    if (r.status === 429 || r.status === 503 || /rate|overload|unavailable|try again/i.test(msg)) {
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

// Minimal Supabase REST helpers
export async function sbInsert(table, rows) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": SUPABASE_KEY,
      "authorization": `Bearer ${SUPABASE_KEY}`,
      "prefer": "return=representation"
    },
    body: JSON.stringify(rows)
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.message) || "supabase insert failed");
  return data;
}

export async function sbSelect(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { "apikey": SUPABASE_KEY, "authorization": `Bearer ${SUPABASE_KEY}` }
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.message) || "supabase select failed");
  return data;
}

export async function sbRpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": SUPABASE_KEY,
      "authorization": `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify(args)
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.message) || "supabase rpc failed");
  return data;
}

export async function sbDelete(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: { "apikey": SUPABASE_KEY, "authorization": `Bearer ${SUPABASE_KEY}` }
  });
  if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.message || "supabase delete failed"); }
  return true;
}
