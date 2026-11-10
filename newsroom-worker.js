const ALLOWED_ORIGINS = new Set([
  "https://newsroom.falsewinger.com",
  "https://sripad13.github.io"
]);

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, CF-Access-Jwt-Assertion",
    "Vary": "Origin"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(origin) }
  });
}
function cleanSource(row) {
  return {
    id: row.id, name: row.name, feed_url: row.feed_url, sport: row.sport,
    priority: row.priority, enabled: Boolean(row.enabled),
    created_at: row.created_at, updated_at: row.updated_at,
    last_fetched_at: row.last_fetched_at
  };
}
function validFeedUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch { return false; }
}
async function listSources(db) {
  const result = await db.prepare(
    "SELECT id, name, feed_url, sport, priority, enabled, created_at, updated_at, last_fetched_at FROM newsroom_sources ORDER BY priority ASC, name COLLATE NOCASE ASC"
  ).all();
  return (result.results || []).map(cleanSource);
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (!ALLOWED_ORIGINS.has(origin) && origin !== "") return json({ error: "Origin not allowed." }, 403, origin);
    if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 503, origin);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ ok: true, service: "thesportzine-newsroom", database: "connected" }, 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/api/sources") {
        return json({ sources: await listSources(env.DB) }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/sources") {
        const body = await request.json();
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const feedUrl = typeof body.feed_url === "string" ? body.feed_url.trim() : "";
        const sport = typeof body.sport === "string" ? body.sport.trim() : "General sports";
        const priority = Number(body.priority ?? 2);
        if (!name || name.length > 100) return json({ error: "Publication name is required (maximum 100 characters)." }, 400, origin);
        if (!validFeedUrl(feedUrl) || feedUrl.length > 2048) return json({ error: "Enter a valid public HTTP or HTTPS RSS/Atom URL." }, 400, origin);
        if (!Number.isInteger(priority) || priority < 1 || priority > 3) return json({ error: "Priority must be 1 (high), 2 (normal) or 3 (low)." }, 400, origin);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        try {
          await env.DB.prepare("INSERT INTO newsroom_sources (id,name,feed_url,sport,priority,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
            .bind(id, name, feedUrl, sport.slice(0, 60), priority, body.enabled === false ? 0 : 1, now, now).run();
        } catch (error) {
          if (/unique/i.test(error.message)) return json({ error: "That RSS feed URL has already been added." }, 409, origin);
          throw error;
        }
        return json({ source: (await env.DB.prepare("SELECT * FROM newsroom_sources WHERE id = ?").bind(id).first()) }, 201, origin);
      }
      const match = url.pathname.match(/^\/api\/sources\/([a-f0-9-]{36})$/i);
      if (match && request.method === "PATCH") {
        const current = await env.DB.prepare("SELECT * FROM newsroom_sources WHERE id = ?").bind(match[1]).first();
        if (!current) return json({ error: "Source not found." }, 404, origin);
        const body = await request.json();
        const name = body.name === undefined ? current.name : String(body.name).trim();
        const feedUrl = body.feed_url === undefined ? current.feed_url : String(body.feed_url).trim();
        const sport = body.sport === undefined ? current.sport : String(body.sport).trim().slice(0, 60);
        const priority = body.priority === undefined ? current.priority : Number(body.priority);
        const enabled = body.enabled === undefined ? current.enabled : (body.enabled ? 1 : 0);
        if (!name || name.length > 100) return json({ error: "Publication name is required (maximum 100 characters)." }, 400, origin);
        if (!validFeedUrl(feedUrl) || feedUrl.length > 2048) return json({ error: "Enter a valid public HTTP or HTTPS RSS/Atom URL." }, 400, origin);
        if (!Number.isInteger(priority) || priority < 1 || priority > 3) return json({ error: "Priority must be 1, 2 or 3." }, 400, origin);
        const now = new Date().toISOString();
        try {
          await env.DB.prepare("UPDATE newsroom_sources SET name=?,feed_url=?,sport=?,priority=?,enabled=?,updated_at=? WHERE id=?")
            .bind(name, feedUrl, sport, priority, enabled, now, match[1]).run();
        } catch (error) {
          if (/unique/i.test(error.message)) return json({ error: "That RSS feed URL has already been added." }, 409, origin);
          throw error;
        }
        return json({ source: cleanSource(await env.DB.prepare("SELECT * FROM newsroom_sources WHERE id = ?").bind(match[1]).first()) }, 200, origin);
      }
      if (match && request.method === "DELETE") {
        const result = await env.DB.prepare("DELETE FROM newsroom_sources WHERE id = ?").bind(match[1]).run();
        if (!result.meta?.changes) return json({ error: "Source not found." }, 404, origin);
        return json({ ok: true, id: match[1] }, 200, origin);
      }
      return json({ error: "Not found." }, 404, origin);
    } catch (error) {
      return json({ error: error.message || "Newsroom API request failed." }, 500, origin);
    }
  }
};
