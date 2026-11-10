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

const DEFAULT_FEEDS = [
  {name:"BBC Sport Football",sport:"football",url:"https://feeds.bbci.co.uk/sport/football/rss.xml"},
  {name:"Sky Sports Football",sport:"football",url:"https://www.skysports.com/rss/11095"},
  {name:"BBC Sport Formula 1",sport:"f1",url:"https://feeds.bbci.co.uk/sport/formula1/rss.xml"},
  {name:"Sky Sports Formula 1",sport:"f1",url:"https://www.skysports.com/rss/12433"},
  {name:"Autosport F1",sport:"f1",url:"https://www.autosport.com/rss/feed/f1"},
  {name:"Motorsport.com F1",sport:"f1",url:"https://www.motorsport.com/rss/f1/news/"},
  {name:"Formula1.com",sport:"f1",url:"https://www.formula1.com/content/fom-website/en/latest/all.xml"}
];
function decodeXml(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
}
function tag(block,name) {
  const re=new RegExp("<(?:[\\w.-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + "\\s*>","i");
  const m=block.match(re);return m?decodeXml(m[1]):"";
}
function parseFeed(xml,feed) {
  return [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match)=>{
    const block=match[2],title=tag(block,"title");let link=tag(block,"link");
    if(!link){const lm=block.match(/<link[^>]+href=["']([^"']+)["']/i);if(lm)link=lm[1];}
    const summary=tag(block,"description")||tag(block,"summary")||tag(block,"content");
    const published=tag(block,"pubDate")||tag(block,"published")||tag(block,"updated");
    if(!title||!/^https?:\/\//i.test(link))return null;
    const date=published?new Date(published):null,hot=/breaking|confirmed|sacked|resigns|signs|announces|injury|ruled out|crash|penalty|suspended/i.test(title);
    return {id:link,title,summary:summary.slice(0,420),link,source:feed.name,sport:feed.sport,published:published||"",timestamp:date&&!Number.isNaN(date.getTime())?date.getTime():0,timeLabel:date&&!Number.isNaN(date.getTime())?date.toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"UTC"})+" UTC":"Time unavailable",breaking:hot,priority:hot};
  }).filter(Boolean);
}
async function getFeed(feed) {
  try{const response=await fetch(feed.url,{headers:{"Accept":"application/rss+xml, application/atom+xml, application/xml, text/xml","User-Agent":"TheSportzine-Newsroom/1.0"},signal:AbortSignal.timeout(9000)});if(!response.ok)throw new Error("HTTP "+response.status);const xml=await response.text();if(!/<(rss|feed|rdf:RDF)/i.test(xml))throw new Error("Response is not RSS/Atom");return{items:parseFeed(xml,feed),error:null};}
  catch(error){return{items:[],error:error.message};}
}
async function fetchStories() {
  const results=await Promise.all(DEFAULT_FEEDS.map(async feed=>({feed,...await getFeed(feed)})));
  const seen=new Map();
  for(const story of results.flatMap(result=>result.items)){const key=story.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim().split(" ").filter(Boolean).slice(0,10).join(" ");const existing=seen.get(key);if(existing){existing.duplicateCount=(existing.duplicateCount||1)+1;existing.sources=[...(existing.sources||[existing.source]),story.source];}else seen.set(key,story);}
  return{stories:[...seen.values()].sort((a,b)=>b.timestamp-a.timestamp),feeds:results.map(({feed,items,error})=>({name:feed.name,sport:feed.sport,count:items.length,error})),fetched_at:new Date().toISOString()};
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
    try {
      if (request.method === "GET" && url.pathname === "/api/feed") return json(await fetchStories(),200,origin);
      if (request.method === "GET" && url.pathname === "/api/health") {
        if (env.DB) await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ ok: true, service: "thesportzine-newsroom", database: env.DB ? "connected" : "not_configured", feeds: "available" }, 200, origin);
      }
      if (!env.DB) return json({ error: "D1 binding DB is not configured; RSS feed endpoint remains available." }, 503, origin);
      // Generate one short headline on demand (maximum nine words).
      if (request.method === "POST" && url.pathname === "/api/short-title") {
        if (!env.AI) return json({ error: "Workers AI binding AI is not configured." }, 503, origin);
        const body = await request.json();
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 700) : "";
        if (!title || title.length > 300) return json({ error: "A valid article headline is required." }, 400, origin);

        const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [
            {
              role: "system",
              content: "You are a sports newsroom headline editor. Rewrite the supplied article headline as one concise, accurate headline of no more than nine words. Preserve the key subject and factual meaning. Do not add facts, speculation, quotation marks, labels, explanations or alternatives. Output only the headline."
            },
            {
              role: "user",
              content: "Original headline: " + title + (summary ? "\nContext: " + summary : "")
            }
          ],
          temperature: 0.2,
          max_tokens: 40
        });

        let shortTitle = String(result?.response || "").trim()
          .replace(/^["'“”]+|["'“”]+$/g, "")
          .replace(/^(short title|headline):\s*/i, "")
          .replace(/^[-*•]\s*/, "")
          .replace(/\s+/g, " ");
        let wordCount = shortTitle.split(/\s+/).filter(Boolean).length;

        if (!shortTitle || wordCount > 9) {
          return json({ error: "The AI did not return a headline within the nine-word limit. Please try again." }, 502, origin);
        }

        return json({ title: shortTitle, words: wordCount }, 200, origin);
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
