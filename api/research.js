// Vercel serverless function: /api/research
// FREE ENGINE VERSION — powered by Google's Gemini API free tier (no credit card needed).
// Translates the Vishwa Samwad Kendra frontend's requests into Gemini requests,
// runs them with live Google Search grounding, and translates the answers back.
// Your free API key stays on the server and is never exposed to visitors.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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
  const wantsSearch = Array.isArray(body.tools) && body.tools.length > 0;

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
    system += `\n- ALWAYS-INCLUDE SOURCE: In addition to other trusted sources, you MUST run at least one search against bharatdiscovery.org (भारतकोश, a large Hindi encyclopedia) using a "site:bharatdiscovery.org" query for this topic. If it has a relevant article, incorporate its information and cite it. If it has nothing relevant, note that briefly and proceed with other sources.`;
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

  try {
    let { status, data } = await call(geminiBody);

    // If search grounding is unavailable (quota/permissions), retry without it
    if (status !== 200 && wantsSearch) {
      const noTools = { ...geminiBody };
      delete noTools.tools;
      ({ status, data } = await call(noTools));
    }

    if (status !== 200) {
      const msg = (data && data.error && data.error.message) || "The AI service returned an error.";
      const friendly = status === 429
        ? "Free daily AI limit reached for this site. Please try again in a while. (" + msg + ")"
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

    // Respond in the Anthropic-like shape the frontend already understands
    return res.status(200).json({
      content: [{ type: "text", text, citations }],
      stop_reason: cand.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn"
    });
  } catch (err) {
    return res.status(200).json({ error: { message: "Upstream request failed: " + (err.message || "unknown error") } });
  }
}
