// Admin book management: ingest (add), list, delete.
// The browser extracts PDF text (page by page) and posts it here in batches.
// This function chunks + embeds each page and stores it in Supabase.

import { embed, sbInsert, sbSelect, sbDelete } from "./_lib.js";

export const config = { maxDuration: 60 };

// split a page into ~800-char chunks on sentence-ish boundaries
function chunkText(text, size = 800) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const dot = clean.lastIndexOf(". ", end);
      if (dot > i + 200) end = dot + 1;
    }
    out.push(clean.slice(i, end).trim());
    i = end;
  }
  return out.filter(Boolean);
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(200).json({ error: "Server missing SUPABASE_URL / SUPABASE_SERVICE_KEY. Add them in Vercel env vars." });
  }

  try {
    // LIST books
    if (req.method === "GET") {
      const books = await sbSelect("books?select=id,title,pages,created_at&order=created_at.desc");
      return res.status(200).json({ books });
    }

    // DELETE a book (and its chunks via cascade)
    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || (req.body && req.body.id);
      if (!id) return res.status(200).json({ error: "Missing book id" });
      await sbDelete(`books?id=eq.${id}`);
      return res.status(200).json({ ok: true });
    }

    // POST: ingest one batch of pages for a book
    // body: { title, pages:[{page, text}], bookId? , finalize? }
    if (req.method === "POST") {
      const { title, pages, bookId, totalPages } = req.body || {};
      if (!title || !Array.isArray(pages)) return res.status(200).json({ error: "Missing title or pages" });

      // create the book row on the first batch
      let id = bookId;
      if (!id) {
        const created = await sbInsert("books", [{ title, pages: totalPages || pages.length }]);
        id = created[0].id;
      }

      // build chunks for this batch
      const rows = [];
      for (const pg of pages) {
        const parts = chunkText(pg.text || "");
        for (const part of parts) {
          rows.push({ book_id: id, book_title: title, page: pg.page, content: part });
        }
      }

      // embed sequentially (free tier is rate-limited); store as we go
      let embedded = 0;
      for (const row of rows) {
        try {
          row.embedding = await embed(row.content);
          embedded++;
        } catch (e) {
          // if we hit the embedding rate limit, stop and tell the client to slow down / resume
          if (e.status === 429 || /quota|rate|exhausted/i.test(e.message)) {
            // insert whatever we embedded so far
            const done = rows.filter(r => r.embedding);
            if (done.length) await sbInsert("chunks", done);
            return res.status(200).json({ bookId: id, embedded, rateLimited: true,
              message: "Hit the free embedding limit. Wait a minute and continue — progress is saved." });
          }
          throw e;
        }
      }

      if (rows.length) await sbInsert("chunks", rows);
      return res.status(200).json({ bookId: id, embedded, rateLimited: false });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(200).json({ error: err.message || "Server error" });
  }
}
