// Vercel serverless function: /api/research
// FREE ENGINE VERSION — powered by Google's Gemini API free tier (no credit card needed).
// Now also searches a Supabase book library (semantic search) on every query,
// so answers draw from your uploaded 100+ books AND the live web.

import { embed, sbRpc } from "./_lib.js";
import { VSK_NETWORK } from "./_sources.js";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

export const config = { maxDuration: 60 };

// find the most relevant book passages for a query, across all books in Supabase
async function searchBooks(query) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return [];
  try {
    const vec = await embed(query);
    const hits = await sbRpc("match_chunks", { query_embedding: vec, match_count: 8 });
    // keep only reasonably similar passages
    return (hits || []).filter(h => h.similarity > 0.35);
  } catch (e) {
    return []; // never let book search break the main research
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: "Server is missing GEMINI_API_KEY. Add it in Vercel → Project → Settings → Environment Variables, then redeploy." }
    });
  }

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const scope = body.scope || 'both';
  const wantsSearch = scope !== 'books' && Array.isArray(body.tools) && body.tools.length > 0;

  // find the latest user query for book search
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  // search books unless the user chose web-only
  const bookHits = (scope !== 'web' && lastUser)
    ? await searchBooks(typeof lastUser.content === "string" ? lastUser.content : "")
    : [];

  // Always-on source: injected into every search so it's consulted for every query
  const ALWAYS_SOURCES = ["bharatdiscovery.org"];

  // If the user picked specific sources, Gemini's search can't hard-restrict domains,
  // so we enforce it through instructions instead.
  let system = typeof body.system === "string" ? body.system : "";
  const allowed = wantsSearch && body.tools[0] && Array.isArray(body.tools[0].allowed_domains)
    ? body.tools[0].allowed_domains : null;
  if (allowed && allowed.length) {
    const merged = Array.from(new Set([...allowed, ...ALWAYS_SOURCES]));
    system += `\n- STRICT SOURCE RULE: Only use information from these websites: ${merged.join(", ")}. In every search, prefer these sites (you may add site:domain to queries). Ignore results from other sites.`;
  } else if (wantsSearch) {
    const vskList = VSK_NETWORK.map(s => `${s.domain} (${s.name} — ${s.region})`).join(", ");
    system += `\n- VSK NETWORK SOURCES: The Vishwa Samvad Kendra (VSK) network publishes news, articles and archives on Bharat, Hindu society, the Rashtriya Swayamsevak Sangh (RSS) and its associated work, seva activities, culture, and regional events. For any query touching these themes (or a specific state/region), run searches using \"site:<domain>\" against the most relevant of these sites — national ones (vskbharat.com, samvad.in) plus the regional site matching the topic: ${vskList}. Incorporate and cite what they provide. Treat them as organisational/advocacy publications: attribute their claims to them and distinguish their reporting from independent sources. If they have nothing relevant, proceed without them.`;
    system += `\n- ALWAYS-INCLUDE SOURCE: In addition to other trusted sources, you MUST run at least one search against bharatdiscovery.org (भारतकोश, a large Hindi encyclopedia) using a "site:bharatdiscovery.org" query for this topic. If it has a relevant article, incorporate its information and cite it. If it has nothing relevant, note that briefly and proceed with other sources.`;
  }

  // If relevant book passages were found, add them to the system prompt with citation rules
  if (bookHits.length) {
    const bookBlock = bookHits.map((h, i) =>
      `[BOOK ${i+1}] From "${h.book_title}", page ${h.page}:\n"${h.content}"`
    ).join("\n\n");
    system += `\n\n--- LIBRARY EXCERPTS ---\nThe site has a private book library. These passages from it are relevant to the user's query. Prefer them for anything they cover, and cite each use inline exactly as 【पुस्तक: "<title>", पृष्ठ <page>】 (or 【Book: "<title>", p.<page>】 in English).${scope === 'books' ? ' Base your entire answer ONLY on these library excerpts and general knowledge — do NOT use the web. If the books do not cover something, say so honestly.' : ' Also use web search for broader context and verification.'}\n\n${bookBlock}\n--- END LIBRARY EXCERPTS ---`;
  } else if (scope === 'books') {
    system += `\n\nNote: The user chose to search ONLY their book library, but no relevant passages were found in the books for this query. Tell the user honestly that the books don't appear to cover this topic, and answer briefly from general knowledge if you can.`;
  }

  // Translate Anthropic-style messages -> Gemini contents
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }]
  }));

  const geminiBody = {
    contents,
    generationConfig: { maxOutputTokens: 60000, temperature: 0.6 }
  };
  if (system) geminiBody.systemInstruction = { parts: [{ text: system }] };
  if (wantsSearch) geminiBody.tools = [{ google_search: {} }];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const call = async (payload) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    return { status: r.status, data: await r.json() };
  };

  // retry transient overload/rate-limit errors (503/429/"high demand") a few times
  const callWithRetry = async (payload, tries = 4) => {
    let last;
    for (let i = 0; i < tries; i++) {
      last = await call(payload);
      const msg = (last.data && last.data.error && last.data.error.message) || '';
      const transient = last.status === 503 || last.status === 429 ||
        /high demand|overloaded|temporarily|try again later|unavailable/i.test(msg);
      if (last.status === 200 || !transient) return last;
      // wait a bit longer each attempt (0.8s, 1.6s, 2.4s)
      await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
    return last;
  };

  try {
    let { status, data } = await callWithRetry(geminiBody);

    // If search grounding is unavailable (quota/permissions), retry without it
    if (status !== 200 && wantsSearch) {
      const noTools = { ...geminiBody };
      delete noTools.tools;
      ({ status, data } = await callWithRetry(noTools));
    }

    if (status !== 200) {
      const msg = (data && data.error && data.error.message) || "The AI service returned an error.";
      const friendly = status === 429
        ? "The free AI service is busy or over its daily limit right now. Please wait a moment and press Retry. (" + msg + ")"
        : msg;
      return res.status(200).json({ error: { message: friendly } });
    }

    const cand = data.candidates && data.candidates[0];
    if (!cand || !cand.content || !Array.isArray(cand.content.parts)) {
      const blocked = data.promptFeedback && data.promptFeedback.blockReason;
      return res.status(200).json({
        error: { message: blocked ? "The request was blocked by the AI's safety filters (" + blocked + "). Try rephrasing." : "No answer was returned. Try rephrasing your question." }
      });
    }

    const text = cand.content.parts.map(p => p.text || "").join("");

    // Extract live web sources from grounding metadata -> Anthropic-style citations
    const citations = [];
    const seen = new Set();
    const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
    for (const ch of chunks) {
      const web = ch.web || {};
      if (web.uri && !seen.has(web.uri)) {
        seen.add(web.uri);
        citations.push({ url: web.uri, title: web.title || web.uri });
      }
    }

    // include unique book sources so the frontend shows them in the Sources rail
    const bookSources = [];
    const bseen = new Set();
    for (const h of bookHits) {
      const key = h.book_title + ":" + h.page;
      if (!bseen.has(key)) { bseen.add(key); bookSources.push({ book: h.book_title, page: h.page }); }
    }

    // Respond in the Anthropic-like shape the frontend already understands
    return res.status(200).json({
      content: [{ type: "text", text, citations }],
      book_sources: bookSources,
      stop_reason: cand.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn"
    });
  } catch (err) {
    return res.status(200).json({ error: { message: "Upstream request failed: " + (err.message || "unknown error") } });
  }
}
