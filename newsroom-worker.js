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
function sportCode(value) {
  const sport=String(value||"general").trim().toLowerCase();
  if(sport==="football")return "football";
  if(sport==="f1"||sport==="formula 1"||sport==="formula one")return "f1";
  if(sport==="general sports"||sport==="general")return "general";
  return sport.replace(/[^a-z0-9]+/g,"-");
}
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
    return {id:link,title,summary:summary.slice(0,420),link,source:feed.name,sport:sportCode(feed.sport),published:published||"",timestamp:date&&!Number.isNaN(date.getTime())?date.getTime():0,timeLabel:date&&!Number.isNaN(date.getTime())?date.toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"UTC"})+" UTC":"Time unavailable",breaking:hot,priority:hot};
  }).filter(Boolean);
}
async function getFeed(feed) {
  try {
    const response = await fetch(feed.url, {
      headers: {
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "User-Agent": "TheSportzine-Newsroom/1.0"
      },
      signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const xml = await response.text();
    const rootMatch = /<(rss|feed|rdf:RDF)\b/i.exec(xml);
    if (!rootMatch) throw new Error("Response is not RSS/Atom");
    const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
    const items = parseFeed(xml, feed);
    const firstBlock = blocks[0]?.[2] || "";
    const firstTitle = firstBlock ? tag(firstBlock, "title") : "";
    let firstLink = firstBlock ? tag(firstBlock, "link") : "";
    if (!firstLink && firstBlock) {
      const linkMatch = firstBlock.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (linkMatch) firstLink = linkMatch[1];
    }
    return {
      items,
      error: null,
      diagnostic: {
        httpStatus: response.status,
        contentType: response.headers.get("content-type") || "",
        bodyLength: xml.length,
        root: rootMatch[1],
        entryBlocks: blocks.length,
        firstEntryHasTitle: Boolean(firstTitle),
        firstEntryHasHttpLink: /^https?:\/\//i.test(firstLink),
        firstEntryStart: firstBlock.slice(0, 350)
      }
    };
  } catch (error) {
    return { items: [], error: error.message, diagnostic: null };
  }
}
async function getConfiguredFeeds(env) {
  let custom = [], deleted = [], edits = [];
  if (env.DB) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS newsroom_source_overrides (feed_url TEXT PRIMARY KEY, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS newsroom_source_edits (feed_url TEXT PRIMARY KEY, name TEXT, override_feed_url TEXT, sport TEXT, updated_at TEXT NOT NULL)").run();
    const [customRows, overrideRows, editRows] = await Promise.all([
      env.DB.prepare("SELECT name, feed_url, sport FROM newsroom_sources WHERE enabled = 1 ORDER BY priority ASC, name COLLATE NOCASE ASC").all(),
      env.DB.prepare("SELECT feed_url FROM newsroom_source_overrides WHERE deleted = 1").all(),
      env.DB.prepare("SELECT feed_url,name,override_feed_url,sport FROM newsroom_source_edits").all()
    ]);
    custom = (customRows.results || []).map(row => ({name:row.name,url:row.feed_url,sport:sportCode(row.sport||"football")}));
    deleted = (overrideRows.results || []).map(row => row.feed_url);
    edits = editRows.results || [];
  }
  const editMap=new Map(edits.map(row=>[row.feed_url,row]));
  const builtins=DEFAULT_FEEDS.map(feed=>{const edit=editMap.get(feed.url)||{};return {name:edit.name||feed.name,url:edit.override_feed_url||feed.url,sport:sportCode(edit.sport||feed.sport)}}).filter(feed=>!deleted.includes(feed.url));
  return [...builtins, ...custom].filter((feed,index,all)=>all.findIndex(item=>item.url===feed.url)===index);
}

const GOOGLE_TRENDS_RPC_ID="i0OFE";
const GOOGLE_TRENDS_BATCH_URL="https://trends.google.com/_/TrendsUi/data/batchexecute";
const FOOTBALL_TREND_TERMS=/\b(football|soccer|premier league|champions league|europa league|conference league|fa cup|carabao cup|efl cup|la liga|serie a|bundesliga|ligue 1|fifa|uefa|world cup|euros|copa america|afcon|afc|isl|indian super league|mls|wsl|ballon d'or|transfer|striker|goalkeeper|manager|head coach|match|fixture|derby|goal|penalty|red card|yellow card|offside|hat.trick|manchester united|manchester city|real madrid|barcelona|atletico madrid|liverpool|arsenal|chelsea|tottenham|spurs|newcastle|aston villa|everton|west ham|brighton|nottingham forest|bayern|borussia dortmund|psg|paris saint.germain|inter milan|ac milan|juventus|napoli|roma|benfica|porto|sporting|ajax|celtic|rangers|al hilal|al nassr|inter miami|argentina|brazil|france|england|spain|germany|portugal|messi|ronaldo|mbappe|haaland|salah|vinicius|bellingham|kane|neymar|lewandowski|palmer|saka|odegaard|rashford|bruno fernandes|de bruyne|yamal|pedri|rodri|van dijk|gyokeres|osimhen|son heung.min)\b/i;
function parseGoogleTrendsPayload(text){
 const body=String(text||"").trim().replace(/^\)\]\}'/,"");const arrays=[];
 for(let i=0;i<body.length;i++){if(body[i]!=="[")continue;let depth=0,inString=false,escaped=false;const start=i;for(;i<body.length;i++){const ch=body[i];if(inString){if(escaped)escaped=false;else if(ch==="\\")escaped=true;else if(ch==='"')inString=false;continue;}if(ch==='"')inString=true;else if(ch==="[")depth++;else if(ch==="]"&&--depth===0){arrays.push(body.slice(start,i+1));break;}}}
 for(const chunk of arrays){let parsed;try{parsed=JSON.parse(chunk)}catch{continue}if(!Array.isArray(parsed))continue;const entry=parsed.find(x=>Array.isArray(x)&&x[0]==="wrb.fr"&&x[1]===GOOGLE_TRENDS_RPC_ID);if(entry){try{return JSON.parse(entry[2])}catch{}}}
 throw new Error("Google Trends response could not be parsed.");
}
async function fetchGoogleTrends(windowName){
 const hours=windowName==="rising"?1:windowName==="hot"?12:24;
 const inner=[null,null,"IN",17,"en-IN",hours,2];
 const requestPayload=[[[GOOGLE_TRENDS_RPC_ID,JSON.stringify(inner),null,"generic"]]];
 const query=new URLSearchParams({rpcids:GOOGLE_TRENDS_RPC_ID,"source-path":"/trending",hl:"en-IN"});
 const body=new URLSearchParams({"f.req":JSON.stringify(requestPayload)});
 const response=await fetch(GOOGLE_TRENDS_BATCH_URL+"?"+query.toString(),{method:"POST",headers:{"accept":"*/*","content-type":"application/x-www-form-urlencoded;charset=UTF-8","origin":"https://trends.google.com","referer":"https://trends.google.com/trending"},body:body.toString(),signal:AbortSignal.timeout(18000)});
 if(!response.ok)throw new Error("Google Trends returned HTTP "+response.status);
 const payload=parseGoogleTrendsPayload(await response.text());
 const rows=Array.isArray(payload)&&Array.isArray(payload[1])?payload[1]:[];
 return rows.map((row,index)=>{
  const query=typeof row?.[0]==="string"?row[0]:"";const volume=row?.[6]??null;const growth=row?.[8]??null;
  const breakdown=Array.isArray(row?.[9])?row[9].filter(x=>typeof x==="string"):[];
  const categories=Array.isArray(row?.[10])?row[10]:[];
  const start=Array.isArray(row?.[3])?Number(row[3][0]):Number(row?.[3]);
  const geo=typeof row?.[2]==="string"?row[2]:"IN";
  const sportsCategory=categories.some(category=>Number(typeof category==="object"?(category.id??category.category_id):category)===17);
  if(!query||!sportsCategory||!FOOTBALL_TREND_TERMS.test([query,...breakdown].join(" ")))return null;
  const volumeLabel=volume==null?null:(Number.isFinite(Number(volume))?Math.trunc(Number(volume))+"+":String(volume));
  const explore=new URLSearchParams({date:hours===1?"now 1-H":hours===12?"now 12-H":"now 1-d",geo,q:query});
  return {query,search_volume:volume,search_volume_label:volumeLabel,increase_percentage:growth,start_timestamp:Number.isFinite(start)?start:null,started_at:Number.isFinite(start)?new Date(start*1000).toISOString():null,position:index+1,explore_url:"https://trends.google.com/trends/explore?"+explore.toString()};
 }).filter(Boolean).sort((a,b)=>(Number(b.search_volume)||0)-(Number(a.search_volume)||0)).slice(0,30);
}


function extractHtmlAttribute(tag,name){const re=new RegExp("\\b"+name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i");const m=tag.match(re);return m?(m[1]||m[2]||m[3]||"").trim():"";}
function decodeHtml(value){return String(value||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));}
async function auditSiteUrl(raw){
 let target;try{target=new URL(raw)}catch{return {error:"Enter a valid URL."}}
 if(!["http:","https:"].includes(target.protocol)||!["thesportzine.com","www.thesportzine.com"].includes(target.hostname.toLowerCase())||target.username||target.password)return {error:"Only public thesportzine.com URLs are allowed."};
 target.hash="";
 const started=Date.now();
 const response=await fetch(target.href,{redirect:"manual",headers:{"User-Agent":"TheSportzine-SEO-Audit/1.0 (+https://thesportzine.com)","Accept":"text/html,application/xhtml+xml"},signal:AbortSignal.timeout(12000)});
 const elapsed=Date.now()-started;
 if(response.status>=300&&response.status<400)return {error:"The URL redirects (HTTP "+response.status+"). Audit the final destination URL directly."};
 const type=response.headers.get("content-type")||"";
 if(!response.ok)return {error:"Page returned HTTP "+response.status+"."};
 if(!/text\/html|application\/xhtml\+xml/i.test(type))return {error:"The URL did not return an HTML page ("+type+")."};
 const reader=response.body?.getReader();let html="",bytes=0;
 if(reader){while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1500000){await reader.cancel();return {error:"Page exceeds the 1.5 MB audit limit."};}html+=new TextDecoder().decode(part.value,{stream:true});}html+=new TextDecoder().decode();}
 else html=await response.text();
 const titleMatch=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
 const title=titleMatch?decodeHtml(titleMatch[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()):"";
 const metaTags=html.match(/<meta\b[^>]*>/gi)||[];
 const metaContent=name=>{const tag=metaTags.find(t=>extractHtmlAttribute(t,"name").toLowerCase()===name);return tag?decodeHtml(extractHtmlAttribute(tag,"content")):"";};
 const description=metaContent("description"),robots=metaContent("robots")||metaContent("googlebot");
 const canonicalTag=(html.match(/<link\b[^>]*>/gi)||[]).find(t=>extractHtmlAttribute(t,"rel").toLowerCase().split(/\s+/).includes("canonical"));
 const canonical=canonicalTag?extractHtmlAttribute(canonicalTag,"href"):"";
 const h1=(html.match(/<h1\b[^>]*>/gi)||[]).length,h2=(html.match(/<h2\b[^>]*>/gi)||[]).length;
 const images=html.match(/<img\b[^>]*>/gi)||[],missingAlt=images.filter(t=>!extractHtmlAttribute(t,"alt")).length;
 const links=html.match(/<a\b[^>]*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi)||[];
 const base=new URL(target.href),internal=links.filter(t=>{const href=extractHtmlAttribute(t,"href");try{return new URL(href,base).hostname===base.hostname}catch{return false}}).length;
 const textContent=html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ").trim();
 const wordCount=textContent?textContent.split(/\s+/).length:0;
 const checks=[];
 const add=(ok,label,detail)=>checks.push({status:ok?"pass":"warning",label,detail});
 add(!!title,"HTML title",title?title.length+" characters":"Missing title tag.");
 add(title.length>=30&&title.length<=60,"Title length",title.length+" characters; editorial target is roughly 30–60.");
 add(!!description,"Meta description",description?description.length+" characters":"Missing meta description.");
 add(description.length>=120&&description.length<=160,"Description length",description.length+" characters; target roughly 120–160.");
 add(h1===1,"Single H1",h1+" H1 elements found; aim for one descriptive H1.");
 add(h2>0,"H2 structure",h2+" H2 elements found.");
 add(!!canonical,"Canonical URL",canonical||"No canonical link found.");
 add(!/noindex/i.test(robots),"Indexability",robots||"No noindex directive found in meta robots.");
 add(images.length===0||missingAlt===0,"Image alt text",missingAlt+" of "+images.length+" images lack an alt attribute.");
 add(internal>0,"Internal links",internal+" internal links detected.");
 add(wordCount>=300,"Visible content",wordCount+" approximate visible words; thin pages may be intentional.");
 const score=Math.round(checks.filter(c=>c.status==="pass").length/checks.length*100);
 return {url:target.href,status:response.status,response_time_ms:elapsed,content_type:type,content_bytes:bytes,title,meta_description:description,canonical,h1,h2,image_count:images.length,images_missing_alt:missingAlt,internal_links:internal,word_count:wordCount,robots,score,checks,audited_at:new Date().toISOString()};
}

async function fetchStories(env) {
  const configured = await getConfiguredFeeds(env);
  const results=await Promise.all(configured.map(async feed=>({feed,...await getFeed(feed)})));
  const seen=new Map();
  for(const story of results.flatMap(result=>result.items)){const key=story.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim().split(" ").filter(Boolean).slice(0,10).join(" ");const existing=seen.get(key);if(existing){existing.duplicateCount=(existing.duplicateCount||1)+1;existing.sources=[...(existing.sources||[existing.source]),story.source];}else seen.set(key,story);}
  return{stories:[...seen.values()].sort((a,b)=>b.timestamp-a.timestamp),feeds:results.map(({feed,items,error,diagnostic})=>({name:feed.name,sport:feed.sport,count:items.length,error,diagnostic})),fetched_at:new Date().toISOString()};
}

async function searchStories(env, keyword) {
  const configured = await getConfiguredFeeds(env);
  const results = await Promise.all(configured.map(async feed => ({ feed, ...await getFeed(feed) })));
  const needle = keyword.toLocaleLowerCase();
  const matches = results.flatMap(result => result.items)
    .filter(story => (story.title + " " + story.summary).toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.timestamp - a.timestamp);
  const seen = new Set();
  const stories = matches.filter(story => {
    const key = story.link || story.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100);
  return {
    keyword,
    stories,
    feeds: results.map(({ feed, items, error }) => ({
      name: feed.name, count: items.length, matches: items.filter(story =>
        (story.title + " " + story.summary).toLocaleLowerCase().includes(needle)
      ).length, error
    })),
    fetched_at: new Date().toISOString()
  };
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
  await db.prepare("CREATE TABLE IF NOT EXISTS newsroom_source_overrides (feed_url TEXT PRIMARY KEY, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS newsroom_source_edits (feed_url TEXT PRIMARY KEY, name TEXT, override_feed_url TEXT, sport TEXT, updated_at TEXT NOT NULL)").run();
  const [result, overrides, edits] = await Promise.all([
    db.prepare("SELECT id, name, feed_url, sport, priority, enabled, created_at, updated_at, last_fetched_at FROM newsroom_sources ORDER BY priority ASC, name COLLATE NOCASE ASC").all(),
    db.prepare("SELECT feed_url FROM newsroom_source_overrides WHERE deleted = 1").all(),
    db.prepare("SELECT feed_url,name,override_feed_url,sport FROM newsroom_source_edits").all()
  ]);
  const deleted = new Set((overrides.results || []).map(row=>row.feed_url));
  const editMap = new Map((edits.results || []).map(row=>[row.feed_url,row]));
  const builtins = DEFAULT_FEEDS.map((feed,index)=>{
    const edit=editMap.get(feed.url)||{};
    return {id:"builtin-"+index,name:edit.name||feed.name,feed_url:edit.override_feed_url||feed.url,sport:edit.sport||feed.sport,priority:1,enabled:true,is_default:true};
  }).filter((feed,index)=>!deleted.has(DEFAULT_FEEDS[index].url));
  return [...builtins,...(result.results||[]).map(row=>({...cleanSource(row),is_default:false}))];
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

      if (request.method === "GET" && url.pathname === "/api/seo/audit") {
        const raw=url.searchParams.get("url")||"";
        const result=await auditSiteUrl(raw);
        if(result.error)return json({error:result.error},400,origin);
        return json(result,200,origin);
      }
      if (request.method === "GET" && url.pathname === "/api/trends") {
        const windowName=url.searchParams.get("window")||"rising";
        if(!["rising","hot","trending"].includes(windowName))return json({error:"Window must be rising, hot or trending."},400,origin);
        const trends=await fetchGoogleTrends(windowName);
        return json({window:windowName,region:"IN",category:"Sports",trends,fetched_at:new Date().toISOString()},200,origin);
      }
      if (request.method === "GET" && url.pathname === "/api/feed") return json(await fetchStories(env),200,origin);
      if (request.method === "GET" && url.pathname === "/api/version") {
        return json({
          service: "thesportzine-newsroom",
          workerVersion: "headline-fix-2026-11-10-02",
          headlineModel: "@cf/google/gemma-4-26b-a4b-it"
        }, 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        if (env.DB) await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ ok: true, service: "thesportzine-newsroom", database: env.DB ? "connected" : "not_configured", feeds: "available" }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/discover-feed") {
        const body=await request.json();const homepage=String(body.url||"").trim();
        if(!validFeedUrl(homepage)||homepage.length>2048)return json({error:"Enter a valid public website URL."},400,origin);
        const base=new URL(homepage);const candidates=[homepage,base.origin+"/feed",base.origin+"/rss",base.origin+"/feed.xml",base.origin+"/rss.xml",base.origin+"/atom.xml",base.origin+"/index.xml"];const found=[];
        for(const candidate of candidates){try{const res=await fetch(candidate,{headers:{"Accept":"application/rss+xml, application/atom+xml, application/xml, text/xml, text/html","User-Agent":"TheSportzine-Newsroom/1.0"},signal:AbortSignal.timeout(6000)});if(!res.ok)continue;const bodyText=await res.text();if(/<(rss|feed|rdf:RDF)\b/i.test(bodyText)){found.push({url:candidate,title:base.hostname});break;}if(candidate===homepage){const tags=bodyText.match(/<link\b[^>]*>/gi)||[];for(const tagText of tags){if(!/alternate/i.test(tagText)||!/(rss|atom)\+xml/i.test(tagText))continue;const href=tagText.match(/href=["']([^"']+)["']/i);if(href){found.push({url:new URL(href[1],homepage).href,title:base.hostname});}}}}catch{}}
        return json({feeds:found},200,origin);
      }
      if (!env.DB) return json({ error: "D1 binding DB is not configured; RSS feed endpoint remains available." }, 503, origin);
      if (request.method === "GET" && url.pathname === "/api/search") {
        const keyword = (url.searchParams.get("keyword") || "").trim();
        if (!keyword || keyword.length > 120) {
          return json({ error: "Enter a keyword or phrase (maximum 120 characters)." }, 400, origin);
        }
        return json(await searchStories(env, keyword), 200, origin);
      }

      // Generate one short headline on demand (maximum nine words).
      if (request.method === "POST" && url.pathname === "/api/short-title") {
        if (!env.AI) return json({ error: "Workers AI binding AI is not configured." }, 503, origin);
        const body = await request.json();
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 700) : "";
        if (!title || title.length > 300) return json({ error: "A valid article headline is required." }, 400, origin);

        const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            {
              role: "system",
              content: "You are a sports newsroom headline editor. Rewrite the supplied article headline as one concise, accurate headline of 9 words or fewer. Preserve the key subject and factual meaning. Do not add facts, speculation, quotation marks, labels, explanations or alternatives. Output only the headline."
            },
            {
              role: "user",
              content: "Rewrite this headline in 9 words or fewer. Return only the headline.\n\nOriginal headline: " + title + (summary ? "\nContext: " + summary : "")
            }
          ],
          temperature: 0.2,
          max_completion_tokens: 80,
          chat_template_kwargs: { enable_thinking: false }
        });

        // Workers AI chat models can return OpenAI-compatible choices or a
        // model-specific response field. Accept either response shape.
        const rawOutput =
          result?.response ??
          result?.choices?.[0]?.message?.content ??
          result?.choices?.[0]?.text ??
          result?.output_text ??
          result?.content ??
          "";
        let shortTitle = (typeof rawOutput === "string" ? rawOutput :
          Array.isArray(rawOutput) ? rawOutput.map(part => part?.text || "").join(" ") :
          String(rawOutput || "")).trim();

        shortTitle = shortTitle
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .replace(/^["'“”]+|["'“”]+$/g, "")
          .replace(/^(short title|headline):\s*/i, "")
          .replace(/^[-*•]\s*/, "")
          .replace(/\s+/g, " ")
          .trim();

        // Enforce the UI's nine-word headline limit if the model slightly
        // exceeds it, rather than failing the entire Create Post workflow.
        const words = shortTitle.split(/\s+/).filter(Boolean);
        if (!shortTitle) {
          return json({
            error: "The AI model returned an empty headline.",
            diagnostic: {
              responseKeys: result && typeof result === "object" ? Object.keys(result) : [],
              finishReason: result?.choices?.[0]?.finish_reason || null
            }
          }, 502, origin);
        }
        if (words.length > 9) shortTitle = words.slice(0, 9).join(" ");
        const wordCount = shortTitle.split(/\s+/).filter(Boolean).length;

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
      const match = url.pathname.match(/^\/api\/sources\/([a-z0-9-]{1,80})$/i);
      if (match && request.method === "PATCH" && match[1].startsWith("builtin-")) {
        const index=Number(match[1].slice(8)),feed=DEFAULT_FEEDS[index];
        if(!feed)return json({error:"Source not found."},404,origin);
        const body=await request.json(),name=String(body.name??feed.name).trim(),feedUrl=String(body.feed_url??feed.url).trim(),sport=String(body.sport??feed.sport).trim();
        if(!name||name.length>100)return json({error:"Publication name is required (maximum 100 characters)."},400,origin);
        if(!validFeedUrl(feedUrl)||feedUrl.length>2048)return json({error:"Enter a valid public HTTP or HTTPS RSS/Atom URL."},400,origin);
        if(!sport||sport.length>60)return json({error:"A valid sport tag is required."},400,origin);
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS newsroom_source_edits (feed_url TEXT PRIMARY KEY, name TEXT, override_feed_url TEXT, sport TEXT, updated_at TEXT NOT NULL)").run();
        await env.DB.prepare("INSERT INTO newsroom_source_edits (feed_url,name,override_feed_url,sport,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(feed_url) DO UPDATE SET name=excluded.name,override_feed_url=excluded.override_feed_url,sport=excluded.sport,updated_at=excluded.updated_at").bind(feed.url,name,feedUrl===feed.url?null:feedUrl,sport,new Date().toISOString()).run();
        const saved=await env.DB.prepare("SELECT name,override_feed_url,sport FROM newsroom_source_edits WHERE feed_url=?").bind(feed.url).first();
        if(!saved||saved.name!==name||saved.sport!==sport||(saved.override_feed_url||feed.url)!==feedUrl)throw new Error("Source edit could not be confirmed in D1.");
        return json({ok:true,id:match[1],source:{id:match[1],name,feed_url:feedUrl,sport,is_default:true}},200,origin);
      }
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
        if (match[1].startsWith("builtin-")) {
          const index = Number(match[1].slice(8));
          const feed = DEFAULT_FEEDS[index];
          if (!feed) return json({ error: "Source not found." }, 404, origin);
          await env.DB.prepare("INSERT INTO newsroom_source_overrides (feed_url,deleted,updated_at) VALUES (?,1,?) ON CONFLICT(feed_url) DO UPDATE SET deleted=1,updated_at=excluded.updated_at").bind(feed.url,new Date().toISOString()).run();
          return json({ ok:true,id:match[1] },200,origin);
        }
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
