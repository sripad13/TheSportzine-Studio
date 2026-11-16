// Short-link redirects for link.falsewinger.com/<code>. Codes are created from the Newsroom Share page.
// Links with a preview image serve a small page carrying Open Graph tags, so chat apps show the image,
// then send visitors on to the article. Plain links get a 302 redirect.
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;
const HOME = "https://newsroom.falsewinger.com/share/";

function notFound() {
  return new Response("Link not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function previewPage(code, row) {
  const target = row.target;
  let host = "";
  try { host = new URL(target).hostname; } catch {}
  const title = row.title || host || "Article";
  const image = row.image_url || "";
  const shortUrl = "https://link.falsewinger.com/" + code;
  const scriptTarget = JSON.stringify(target).replace(/</g, "\\u003c");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:url" content="${escapeHtml(shortUrl)}">${image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escapeHtml(image)}">` : ""}<meta name="twitter:title" content="${escapeHtml(title)}"><meta http-equiv="refresh" content="0;url=${escapeHtml(target)}"><link rel="canonical" href="${escapeHtml(target)}"></head><body><p>Opening <a href="${escapeHtml(target)}">${escapeHtml(host || target)}</a>…</p><script>location.replace(${scriptTarget});</script></body></html>`;
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "strict-origin-when-cross-origin" } });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed.", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const code = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+|\/+$/g, "");
    if (!code) return Response.redirect(HOME, 302);
    if (!CODE_PATTERN.test(code) || !env.DB) return notFound();
    try {
      const row = await env.DB.prepare("SELECT * FROM newsroom_links WHERE code = ?").bind(code).first();
      if (!row || !row.target) return notFound();
      // Count the click without delaying the visitor.
      ctx.waitUntil(env.DB.prepare("UPDATE newsroom_links SET clicks = clicks + 1, last_clicked_at = ? WHERE code = ?").bind(new Date().toISOString(), code).run().catch(() => {}));
      if (row.image_url) return previewPage(code, row);
      return new Response(null, { status: 302, headers: { location: row.target, "cache-control": "no-store", "referrer-policy": "strict-origin-when-cross-origin" } });
    } catch {
      return notFound();
    }
  }
};
