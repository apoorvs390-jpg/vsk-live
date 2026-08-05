// Dedicated OCR endpoint — receives one page image (base64 JPEG), returns text via Gemini vision.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(200).json({ error: "Missing GEMINI_API_KEY" });

  const img = req.body && req.body.image;
  if (!img) return res.status(200).json({ error: "No image" });

  const model = process.env.GEMINI_OCR_MODEL || "gemini-flash-lite-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "Extract ALL text from this scanned page exactly as written. It is mostly Hindi (Devanagari). Output ONLY the raw text, no commentary, preserve reading order." },
            { inline_data: { mime_type: "image/jpeg", data: img } }
          ]
        }],
        generationConfig: { temperature: 0 }
      })
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = (data.error && data.error.message) || "OCR failed";
      if (r.status === 429 || /quota|rate|exhausted|resource/i.test(msg)) {
        return res.status(200).json({ rateLimited: true, message: msg });
      }
      return res.status(200).json({ error: msg });
    }
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts
      ? cand.content.parts.map(p => p.text || "").join(" ") : "";
    return res.status(200).json({ text: (text || "").replace(/\s+/g, " ").trim() });
  } catch (e) {
    return res.status(200).json({ error: e.message || "OCR error" });
  }
}
