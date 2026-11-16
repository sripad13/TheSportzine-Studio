// Short-link redirects for link.falsewinger.com/<code>. Codes are created from the Newsroom Share page.
// Links with a preview image serve a small page carrying Open Graph tags, so chat apps show the image,
// then send visitors on to the article. Plain links get a 302 redirect.
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;
const HOME = "https://studio.falsewinger.com/share/";

const UPLOAD_ORIGINS = new Set(["https://studio.falsewinger.com", "https://newsroom.falsewinger.com"]);
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_NAME_PATTERN = /^[a-f0-9]{24}\.(jpg|png|webp|gif)$/;

function corsHeaders(origin) {
  if (!UPLOAD_ORIGINS.has(origin)) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" };
}
function jsonResponse(data, status, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
}
// Checks the file's leading bytes so only real images are stored, whatever the declared type.
function looksLikeImage(bytes, ext) {
  const b = bytes;
  if (ext === "jpg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === "png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === "gif") return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
  if (ext === "webp") return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return false;
}
async function handleUpload(request, env) {
  const origin = request.headers.get("origin") || "";
  const cors = corsHeaders(origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, cors);
  if (!UPLOAD_ORIGINS.has(origin)) return jsonResponse({ error: "Uploads are only accepted from the Studio app." }, 403);
  if (!env.MEDIA_BUCKET) return jsonResponse({ error: "Image storage is not configured yet." }, 503, cors);
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) return jsonResponse({ error: "Use a JPG, PNG, WebP or GIF image." }, 415, cors);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) return jsonResponse({ error: "The image is empty." }, 400, cors);
  if (bytes.byteLength > MAX_IMAGE_BYTES) return jsonResponse({ error: "Images must be 3 MB or smaller." }, 413, cors);
  if (!looksLikeImage(bytes, ext)) return jsonResponse({ error: "That file is not a valid " + ext.toUpperCase() + " image." }, 415, cors);
  const name = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("") + "." + ext;
  await env.MEDIA_BUCKET.put("links/" + name, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  return jsonResponse({ ok: true, image_url: "https://link.falsewinger.com/img/" + name }, 201, cors);
}
async function handleImage(name, env) {
  if (!IMAGE_NAME_PATTERN.test(name) || !env.MEDIA_BUCKET) return notFound();
  const object = await env.MEDIA_BUCKET.get("links/" + name);
  if (!object) return notFound();
  return new Response(object.body, { status: 200, headers: { "content-type": object.httpMetadata?.contentType || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}

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
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/upload") return handleUpload(request, env);
    if (pathname.startsWith("/img/")) {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed.", { status: 405, headers: { allow: "GET, HEAD" } });
      return handleImage(pathname.slice(5), env);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed.", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const code = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, "");
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
