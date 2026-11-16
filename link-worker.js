// Short-link redirects for link.falsewinger.com/<code>. Codes are created from the Newsroom Share page.
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;
const HOME = "https://newsroom.falsewinger.com/share/";

function notFound() {
  return new Response("Link not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
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
      const row = await env.DB.prepare("SELECT target FROM newsroom_links WHERE code = ?").bind(code).first();
      if (!row || !row.target) return notFound();
      // Count the click without delaying the redirect.
      ctx.waitUntil(env.DB.prepare("UPDATE newsroom_links SET clicks = clicks + 1, last_clicked_at = ? WHERE code = ?").bind(new Date().toISOString(), code).run().catch(() => {}));
      return new Response(null, { status: 302, headers: { location: row.target, "cache-control": "no-store", "referrer-policy": "strict-origin-when-cross-origin" } });
    } catch {
      return notFound();
    }
  }
};
