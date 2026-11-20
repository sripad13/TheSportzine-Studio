const ALLOWED_ORIGINS = new Set([
  "https://studio.falsewinger.com",
  "https://newsroom.falsewinger.com",
  "https://sripad13.github.io"
]);

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, CF-Access-Jwt-Assertion, X-Studio-Key",
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
const NAMED_ENTITIES = {
  amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", ndash:"–", mdash:"—", hellip:"…",
  lsquo:"‘", rsquo:"’", ldquo:"“", rdquo:"”", sbquo:"‚", bdquo:"„", laquo:"«", raquo:"»",
  pound:"£", euro:"€", dollar:"$", cent:"¢", yen:"¥", copy:"©", reg:"®", trade:"™", deg:"°",
  middot:"·", bull:"•", times:"×", frac12:"½", frac14:"¼", frac34:"¾"
};
function decodeEntities(text) {
  // Single pass, so "&amp;lt;" correctly becomes the literal text "&lt;".
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    const named = NAMED_ENTITIES[ref.toLowerCase()];
    return named === undefined ? whole : named;
  });
}
function decodeXml(value) {
  let text = String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Feeds often entity-encode HTML inside <description>: strip real tags, decode, then strip any tags that decoding revealed.
  text = text.replace(/<[^>]*>/g, " ");
  text = decodeEntities(text);
  // Entity-encoded HTML (e.g. "&lt;p&gt;Fish &amp;amp; chips&lt;/p&gt;") carries a second layer of entities.
  if (/<\/?[a-z][^>]*>/i.test(text)) text = decodeEntities(text.replace(/<\/?[a-z][^>]*>/gi, " "));
  return text.replace(/\s+/g, " ").trim();
}
function tag(block,name) {
  const re=new RegExp("<(?:[\\w.-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + "\\s*>","i");
  const m=block.match(re);return m?decodeXml(m[1]):"";
}
const BREAKING_TERMS=/\b(breaking|confirmed|sacked|resigns|signs|signed|announces|injury|injured|ruled out|crash|crashes|penalty|suspended|banned)\b/i;
function parseFeed(xml,feed) {
  return [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match)=>{
    const block=match[2],title=tag(block,"title");let link=tag(block,"link");
    if(!link){const lm=block.match(/<link[^>]+href=["']([^"']+)["']/i);if(lm)link=lm[1];}
    const summary=tag(block,"description")||tag(block,"summary")||tag(block,"content");
    const published=tag(block,"pubDate")||tag(block,"published")||tag(block,"updated");
    if(!title||!/^https?:\/\//i.test(link))return null;
    const date=published?new Date(published):null,hot=BREAKING_TERMS.test(title);
    return {id:link,title,summary:summary.slice(0,420),link,source:feed.name,sport:sportCode(feed.sport),published:published||"",timestamp:date&&!Number.isNaN(date.getTime())?date.getTime():0,timeLabel:date&&!Number.isNaN(date.getTime())?date.toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"UTC"})+" UTC":"Time unavailable",breaking:hot,priority:hot};
  }).filter(Boolean);
}
const FEED_CACHE = new Map();
const FEED_CACHE_TTL_MS = 3 * 60 * 1000;
async function getFeed(feed, { fresh = false } = {}) {
  const cached = FEED_CACHE.get(feed.url);
  // A manual refresh still reuses results younger than 30 seconds, so repeated clicks cannot flood publishers.
  const maxAge = fresh ? 30 * 1000 : FEED_CACHE_TTL_MS;
  if (cached && Date.now() - cached.at < maxAge) {
    return { ...cached.result, items: cached.result.items.map(item => ({ ...item, source: feed.name, sport: sportCode(feed.sport) })) };
  }
  const result = await fetchFeedUncached(feed);
  // Cache successes and failures alike so a broken publisher is not hammered by every column.
  FEED_CACHE.set(feed.url, { at: Date.now(), result });
  if (FEED_CACHE.size > 200) FEED_CACHE.delete(FEED_CACHE.keys().next().value);
  return result;
}
async function fetchFeedUncached(feed) {
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
    const items = parseFeed(xml, feed);
    return {
      items,
      error: null,
      diagnostic: { httpStatus: response.status, root: rootMatch[1], entryBlocks: (xml.match(/<(item|entry)[\s>]/gi) || []).length }
    };
  } catch (error) {
    return { items: [], error: error.message, diagnostic: null };
  }
}
let schemaReady = null;
async function ensureNewsroomSchema(db) {
  if (!db || typeof db.prepare !== "function") return;
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS newsroom_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, feed_url TEXT NOT NULL UNIQUE, sport TEXT NOT NULL DEFAULT 'General sports', priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3), enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_fetched_at TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS newsroom_source_overrides (feed_url TEXT PRIMARY KEY, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS newsroom_source_edits (feed_url TEXT PRIMARY KEY, name TEXT, override_feed_url TEXT, sport TEXT, updated_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS newsroom_saved_stories (id TEXT PRIMARY KEY, story_json TEXT NOT NULL, saved_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS newsroom_links (code TEXT PRIMARY KEY, target TEXT NOT NULL, created_at TEXT NOT NULL, clicks INTEGER NOT NULL DEFAULT 0, last_clicked_at TEXT)")
    ]).catch(error => { schemaReady = null; throw error; });
  }
  await schemaReady;
  await ensureLinkColumns(db);
}
let linkColumnsReady = null;
async function ensureLinkColumns(db) {
  if (!linkColumnsReady) {
    linkColumnsReady = (async () => {
      const info = await db.prepare("PRAGMA table_info(newsroom_links)").all();
      const names = new Set((info.results || []).map(c => c.name));
      if (!names.has("image_url")) await db.prepare("ALTER TABLE newsroom_links ADD COLUMN image_url TEXT").run();
      if (!names.has("title")) await db.prepare("ALTER TABLE newsroom_links ADD COLUMN title TEXT").run();
    })().catch(error => { linkColumnsReady = null; throw error; });
  }
  await linkColumnsReady;
}
async function getConfiguredFeeds(env) {
  let custom = [], deleted = [], edits = [];
  if (env.DB && typeof env.DB.prepare === "function") {
    await ensureNewsroomSchema(env.DB);
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
  const builtins=DEFAULT_FEEDS.filter(feed=>!deleted.includes(feed.url)).map(feed=>{const edit=editMap.get(feed.url)||{};return {name:edit.name||feed.name,url:edit.override_feed_url||feed.url,sport:sportCode(edit.sport||feed.sport)}});
  return [...builtins, ...custom].filter((feed,index,all)=>all.findIndex(item=>item.url===feed.url)===index);
}

const GOOGLE_TRENDS_RPC_ID="i0OFE";
const GOOGLE_TRENDS_BATCH_URL="https://trends.google.com/_/TrendsUi/data/batchexecute";
const FOOTBALL_TREND_TERMS=/\b(football|soccer|premier league|champions league|europa league|conference league|fa cup|carabao cup|efl cup|la liga|serie a|bundesliga|ligue 1|fifa|uefa|world cup|euros|copa america|afcon|isl|indian super league|mls|wsl|ballon d'or|striker|goalkeeper|red card|yellow card|offside|hat.trick|manchester united|manchester city|real madrid|barcelona|atletico madrid|liverpool|arsenal|chelsea|tottenham|spurs|newcastle|aston villa|everton|west ham|brighton|nottingham forest|bayern|borussia dortmund|psg|paris saint.germain|inter milan|ac milan|juventus|napoli|benfica|porto|ajax|celtic|al hilal|al nassr|inter miami|argentina|brazil|france|england|spain|germany|portugal|messi|ronaldo|mbappe|haaland|salah|vinicius|bellingham|kane|neymar|lewandowski|palmer|saka|odegaard|rashford|bruno fernandes|de bruyne|yamal|pedri|rodri|van dijk|gyokeres|osimhen|son heung.min|nico williams|pickford|cucurella|konsa|calvin bassey|foden|wirtz|isak|gakpo|tuchel|guardiola|arteta|amorim|pochettino|maresca|postecoglou|crystal palace|bournemouth|fulham|leeds|burnley|sunderland|ipswich|southampton|sheffield united|brentford|millwall|coventry|hibernian|hull city|stoke city|norwich|watford|sheffield wednesday|blackburn|preston|champions league final|nations league|fa cup final|lamine yamal|mac allister|trafford|mainoo|alexander.arnold)\b/i;
function parseGoogleTrendsPayload(text){
 const body=String(text||"").trim().replace(/^\)\]\}'/,"");const arrays=[];
 for(let i=0;i<body.length;i++){if(body[i]!=="[")continue;let depth=0,inString=false,escaped=false;const start=i;for(;i<body.length;i++){const ch=body[i];if(inString){if(escaped)escaped=false;else if(ch==="\\")escaped=true;else if(ch==='"')inString=false;continue;}if(ch==='"')inString=true;else if(ch==="[")depth++;else if(ch==="]"&&--depth===0){arrays.push(body.slice(start,i+1));break;}}}
 for(const chunk of arrays){let parsed;try{parsed=JSON.parse(chunk)}catch{continue}if(!Array.isArray(parsed))continue;const entry=parsed.find(x=>Array.isArray(x)&&x[0]==="wrb.fr"&&x[1]===GOOGLE_TRENDS_RPC_ID);if(entry){try{return JSON.parse(entry[2])}catch{}}}
 throw new Error("Google Trends response could not be parsed.");
}
const F1_TREND_TERMS=/\b(formula 1|formula one|f1|grand prix|verstappen|hamilton|leclerc|norris|piastri|russell|sainz|alonso|stroll|gasly|ocon|tsunoda|albon|antonelli|hadjar|bearman|liam lawson|pit stop|paddock|red bull racing|racing bulls|aston martin f1|haas f1|pole position|silverstone gp|monaco gp)\b/i;
function classifyTrend(text){if(FOOTBALL_TREND_TERMS.test(text))return "football";if(F1_TREND_TERMS.test(text))return "f1";return null}
function decodeXmlText(value){return String(value||"").replace(/^<!\[CDATA\[|\]\]>$/g,"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,"&").trim()}
async function fetchGoogleTrendsBatch(windowName){
 const hours=windowName==="rising"?1:windowName==="hot"?12:24;
 const inner=[null,null,"GB",17,"en-GB",hours,2];
 const requestPayload=[[[GOOGLE_TRENDS_RPC_ID,JSON.stringify(inner),null,"generic"]]];
 const query=new URLSearchParams({rpcids:GOOGLE_TRENDS_RPC_ID,"source-path":"/trending",hl:"en-GB"});
 const body=new URLSearchParams({"f.req":JSON.stringify(requestPayload)});
 const response=await fetch(GOOGLE_TRENDS_BATCH_URL+"?"+query.toString(),{method:"POST",headers:{"accept":"*/*","content-type":"application/x-www-form-urlencoded;charset=UTF-8","origin":"https://trends.google.com","referer":"https://trends.google.com/trending"},body:body.toString(),signal:AbortSignal.timeout(18000)});
 if(!response.ok)throw new Error("Google Trends returned HTTP "+response.status);
 const payload=parseGoogleTrendsPayload(await response.text());
 const rows=Array.isArray(payload)&&Array.isArray(payload[1])?payload[1]:[];
 return rows.map((row,index)=>{
  const title=typeof row?.[0]==="string"?row[0]:"";const volume=row?.[6]??null;const growth=row?.[8]??null;
  const breakdown=Array.isArray(row?.[9])?row[9].filter(x=>typeof x==="string"):[];
  const start=Array.isArray(row?.[3])?Number(row[3][0]):Number(row?.[3]);
  const section=title?classifyTrend([title,...breakdown].join(" ")):null;
  if(!section)return null;
  const volumeLabel=volume==null?null:(Number.isFinite(Number(volume))?Math.trunc(Number(volume))+"+":String(volume));
  const explore=new URLSearchParams({date:hours===1?"now 1-H":hours===12?"now 12-H":"now 1-d",geo:"GB",q:title});
  return {query:title,section,search_volume:volume,search_volume_label:volumeLabel,increase_percentage:growth,start_timestamp:Number.isFinite(start)?start:null,started_at:Number.isFinite(start)?new Date(start*1000).toISOString():null,position:index+1,explore_url:"https://trends.google.com/trends/explore?"+explore.toString()};
 }).filter(Boolean).sort((a,b)=>(Number(b.search_volume)||0)-(Number(a.search_volume)||0)).slice(0,30);
}
// Fallback: Google's public Trends RSS for the UK (last 24 hours, no growth figures).
async function fetchGoogleTrendsRss(){
 const response=await fetch("https://trends.google.com/trending/rss?geo=GB",{headers:{accept:"application/rss+xml, application/xml;q=0.9"},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error("Google Trends RSS returned HTTP "+response.status);
 const xml=await response.text();
 return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m,index)=>{
  const block=m[1];const tag=name=>{const hit=block.match(new RegExp("<"+name+"[^>]*>([\\s\\S]*?)<\\/"+name+">"));return hit?decodeXmlText(hit[1]):""};
  const title=tag("title");const traffic=tag("ht:approx_traffic");const started=Date.parse(tag("pubDate"));
  const section=title?classifyTrend(title):null;
  if(!section)return null;
  const start=Number.isFinite(started)?Math.floor(started/1000):null;
  const explore=new URLSearchParams({date:"now 1-d",geo:"GB",q:title});
  return {query:title,section,search_volume:Number(traffic.replace(/[^\d]/g,""))||null,search_volume_label:traffic||null,increase_percentage:null,start_timestamp:start,started_at:start?new Date(start*1000).toISOString():null,position:index+1,explore_url:"https://trends.google.com/trends/explore?"+explore.toString()};
 }).filter(Boolean).slice(0,30);
}
async function fetchGoogleTrends(windowName){
 let trends=[],source="batch",error=null;
 try{trends=await fetchGoogleTrendsBatch(windowName)}catch(e){error=e.message}
 const batch_error=error;
 if(!trends.length){try{trends=await fetchGoogleTrendsRss();source="rss"}catch(e){error=error?error+"; "+e.message:e.message}}
 if(!trends.length&&error)throw new Error(error);
 return {trends,source,batch_error};
}


function extractHtmlAttribute(tag,name){const re=new RegExp("\\b"+name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i");const m=tag.match(re);return m?(m[1]||m[2]||m[3]||"").trim():"";}
function decodeHtml(value){return String(value||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));}
const AUDIT_RATE_LIMITS=new Map();
async function allowAuditRequest(request,env,limit=5,bucket="audit"){
 const ip=bucket+":"+(request.headers.get("CF-Connecting-IP")||"unknown"),now=Date.now(),windowMs=60*60*1000;
 if(env.DB && typeof env.DB.prepare === "function"){
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_audit_rate_limits (ip_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, request_count INTEGER NOT NULL)").run();
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(ip));
  const key=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
  const windowStart=Math.floor(now/windowMs)*windowMs;
  const row=await env.DB.prepare("INSERT INTO ai_audit_rate_limits (ip_hash,window_start,request_count) VALUES (?,?,1) ON CONFLICT(ip_hash) DO UPDATE SET request_count=CASE WHEN ai_audit_rate_limits.window_start < excluded.window_start THEN 1 ELSE ai_audit_rate_limits.request_count+1 END,window_start=CASE WHEN ai_audit_rate_limits.window_start < excluded.window_start THEN excluded.window_start ELSE ai_audit_rate_limits.window_start END RETURNING request_count").bind(key,windowStart).first();
  return Number(row?.request_count||0)<=limit;
 }
 if(AUDIT_RATE_LIMITS.size>5000){for(const [key,value] of AUDIT_RATE_LIMITS)if(now-value.windowStart>=windowMs)AUDIT_RATE_LIMITS.delete(key);}
 const existing=AUDIT_RATE_LIMITS.get(ip);
 if(!existing||now-existing.windowStart>=windowMs){AUDIT_RATE_LIMITS.set(ip,{windowStart:now,count:1});return true;}
 existing.count++;return existing.count<=limit;
}
const AI_CRAWLERS=[
 {name:"GPTBot",ua:"GPTBot"},
 {name:"OAI-SearchBot",ua:"OAI-SearchBot"},
 {name:"ChatGPT-User",ua:"ChatGPT-User"},
 {name:"ClaudeBot",ua:"ClaudeBot"},
 {name:"Claude-SearchBot",ua:"Claude-SearchBot"},
 {name:"Claude-User",ua:"Claude-User"},
 {name:"anthropic-ai",ua:"anthropic-ai"},
 {name:"PerplexityBot",ua:"PerplexityBot"},
 {name:"Perplexity-User",ua:"Perplexity-User"},
 {name:"Google-Extended",ua:"Google-Extended"},
 {name:"Googlebot",ua:"Googlebot"},
 {name:"Bingbot",ua:"bingbot"},
 {name:"Applebot-Extended",ua:"Applebot-Extended"},
 {name:"Bytespider",ua:"Bytespider"},
 {name:"Meta-ExternalAgent",ua:"Meta-ExternalAgent"},
 {name:"Amazonbot",ua:"Amazonbot"},
 {name:"cohere-ai",ua:"cohere-ai"}
];
const AUDIT_WEIGHTS={crawler:25,html:18,structured:12,files:8,metadata:8,trust:6,aeo:11,geo:12};
function isSafePublicTarget(raw){
 let target;try{target=new URL(raw)}catch{return {error:"Enter a valid public website URL."}}
 if(!["http:","https:"].includes(target.protocol)||target.username||target.password)return {error:"Only public HTTP or HTTPS website URLs are supported."};
 const host=target.hostname.toLowerCase().replace(/^\[|\]$/g,"");
 if(!host||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host==="metadata.google.internal"||host==="0.0.0.0"||host==="::1"||host==="::"||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)||host.includes(":"))return {error:"Private, local and IP-literal destinations are not supported. Enter a public website hostname."};
 if(target.port&&target.port!=="80"&&target.port!=="443")return {error:"Only standard HTTP and HTTPS ports are supported."};
 target.hash="";
 return {url:target};
}
async function readResponseText(response,maxBytes){
 const reader=response.body?.getReader();let text="",bytes=0;
 if(!reader){const value=await response.text();if(new TextEncoder().encode(value).length>maxBytes)throw new Error("Response exceeds audit size limit.");return value;}
 const decoder=new TextDecoder();
 while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes){await reader.cancel();throw new Error("Response exceeds audit size limit.");}text+=decoder.decode(part.value,{stream:true});}
 return text+decoder.decode();
}
async function publicFetch(url,headers={},timeout=7000){
 const safe=isSafePublicTarget(url.href||String(url));if(safe.error)throw new Error(safe.error);
 return fetch(safe.url.href,{redirect:"manual",headers,signal:AbortSignal.timeout(timeout)});
}
function parseRobots(text){
 const groups=[];let agents=[],rules=[];
 const flush=()=>{if(agents.length)groups.push({agents:[...agents],rules:[...rules]});agents=[];rules=[];};
 for(const raw of String(text||"").split(/\r?\n/)){
  const line=raw.replace(/#.*$/,"").trim();if(!line)continue;
  const colon=line.indexOf(":");if(colon<0)continue;
  const key=line.slice(0,colon).trim().toLowerCase(),value=line.slice(colon+1).trim();
  if(key==="user-agent"){if(rules.length)flush();agents.push(value.toLowerCase());}
  else if((key==="allow"||key==="disallow")&&agents.length)rules.push({type:key,path:value});
 }
 flush();return groups;
}
function robotsRuleMatches(pattern,path){
 const anchored=pattern.endsWith("$"),raw=anchored?pattern.slice(0,-1):pattern;
 const escaped=raw.split("").map(ch=>".+?^${}()|[]\\".includes(ch)?"\\"+ch:ch).join("").replaceAll("*",".*");
 try{return new RegExp("^"+escaped+(anchored?"$":"")).test(path);}catch{return path.startsWith(pattern);}
}
function robotsDecision(groups,ua,path){
 const matches=groups.filter(g=>g.agents.some(a=>a==="*"||ua.toLowerCase().includes(a)));
 if(!matches.length)return {allowed:true,rule:"No matching robots.txt rule; allowed by default."};
 const specific=matches.filter(g=>g.agents.some(a=>a!=="*"&&ua.toLowerCase().includes(a)));
 const selected=specific.length?specific:matches;
 const rules=selected.flatMap(g=>g.rules).filter(r=>r.path!=="").filter(r=>robotsRuleMatches(r.path,path)).sort((a,b)=>b.path.length-a.path.length);
 if(!rules.length)return {allowed:true,rule:"No matching disallow rule."};
 const winner=rules[0],ties=rules.filter(r=>r.path.length===winner.path.length);
 const allowed=ties.some(r=>r.type==="allow");
 return {allowed,rule:(allowed?"Allow: ":"Disallow: ")+winner.path};
}
async function mapLimit(items,limit,fn){
 const results=new Array(items.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=cursor++;if(i>=items.length)return;try{results[i]=await fn(items[i],i)}catch(error){results[i]={error:error.message||"Request failed"};}}}));
 return results;
}
async function auditSiteUrl(raw,options={}){
 const safe=isSafePublicTarget(raw);if(safe.error)return {error:safe.error};
 const target=safe.url,started=Date.now(),origin=target.origin;
 const pageResponse=await publicFetch(target,{"User-Agent":"TheSportzine-AI-Visibility-Audit/1.0 (+https://thesportzine.com)","Accept":"text/html,application/xhtml+xml"},10000);
 if(pageResponse.status>=300&&pageResponse.status<400){const location=pageResponse.headers.get("location");return {error:"The page redirects. Audit the final destination URL directly"+(location?" ("+new URL(location,target).origin+")":".")};}
 if(!pageResponse.ok)return {error:"Website returned HTTP "+pageResponse.status+"."};
 const contentType=pageResponse.headers.get("content-type")||"";
 if(!/text\/html|application\/xhtml\+xml/i.test(contentType))return {error:"The URL did not return an HTML page ("+contentType+")."};
 const html=await readResponseText(pageResponse,1500000),responseTime=Date.now()-started;
 const [robotsResponse,sitemapResponse,llmsResponse]=options.skipSiteFiles?[null,null,null]:await Promise.all([
  publicFetch(new URL("/robots.txt",origin),{"User-Agent":"TheSportzine-AI-Visibility-Audit/1.0","Accept":"text/plain"}).catch(()=>null),
  publicFetch(new URL("/sitemap.xml",origin),{"User-Agent":"TheSportzine-AI-Visibility-Audit/1.0","Accept":"application/xml,text/xml"}).catch(()=>null),
  publicFetch(new URL("/llms.txt",origin),{"User-Agent":"TheSportzine-AI-Visibility-Audit/1.0","Accept":"text/plain"}).catch(()=>null)
 ]);
 let robotsText="",sitemapText="",llmsText="";
 if(robotsResponse?.ok)robotsText=await readResponseText(robotsResponse,300000).catch(()=> "");
 if(sitemapResponse?.ok)sitemapText=await readResponseText(sitemapResponse,500000).catch(()=> "");
 if(llmsResponse?.ok)llmsText=await readResponseText(llmsResponse,300000).catch(()=> "");
 const robotsGroups=parseRobots(robotsText),robotsAvailable=!!robotsResponse&&robotsResponse.status===200;
 const titleMatch=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
 const title=titleMatch?decodeHtml(titleMatch[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()):"";
 const metaTags=html.match(/<meta\b[^>]*>/gi)||[];
 const metaContent=name=>{const tag=metaTags.find(t=>extractHtmlAttribute(t,"name").toLowerCase()===name);return tag?decodeHtml(extractHtmlAttribute(tag,"content")):"";};
 const description=metaContent("description"),robotsMeta=metaContent("robots")||metaContent("googlebot");
 const canonicalTag=(html.match(/<link\b[^>]*>/gi)||[]).find(t=>extractHtmlAttribute(t,"rel").toLowerCase().split(/\s+/).includes("canonical"));
 const canonical=canonicalTag?extractHtmlAttribute(canonicalTag,"href"):"";
 const h1=(html.match(/<h1\b[^>]*>/gi)||[]).length,h2=(html.match(/<h2\b[^>]*>/gi)||[]).length;
 const images=html.match(/<img\b[^>]*>/gi)||[],missingAlt=images.filter(t=>!extractHtmlAttribute(t,"alt")).length;
 const scripts=(html.match(/<script\b[^>]*>/gi)||[]).length;
 const bodyText=html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ").trim();
 const wordCount=bodyText?bodyText.split(/\s+/).length:0;
 const jsonLd=[...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
 let validJsonLd=0,schemaTypes=[];
 for(const rawJson of jsonLd){try{const parsed=JSON.parse(rawJson);validJsonLd++;const walk=value=>{if(!value||typeof value!=="object")return;if(value["@type"])schemaTypes.push(...(Array.isArray(value["@type"])?value["@type"]:[value["@type"]]));for(const child of Object.values(value))if(child&&typeof child==="object")Array.isArray(child)?child.forEach(walk):walk(child);};walk(parsed);}catch{}}
 const crawlerResults=options.skipCrawlerProbes?[]:await mapLimit(AI_CRAWLERS,5,async crawler=>{
  const policy=robotsAvailable?robotsDecision(robotsGroups,crawler.ua,target.pathname+target.search):{allowed:true,rule:"robots.txt unavailable; no published restriction could be confirmed."};
  if(!policy.allowed)return {name:crawler.name,user_agent:crawler.ua,robots_allowed:false,robots_rule:policy.rule,http_status:null,reachable:false,redirected:false,content_type:"",status:"warning",detail:"Disallowed by robots.txt; live HTTP probe skipped."};
  let probe;
  try{probe=await publicFetch(target,{"User-Agent":crawler.ua,"Accept":"text/html,application/xhtml+xml"},6500);}
  catch(error){return {name:crawler.name,user_agent:crawler.ua,robots_allowed:policy.allowed,robots_rule:policy.rule,http_status:null,reachable:false,redirected:false,content_type:"",status:"warning",detail:"Crawler request failed: "+(error.message||"network error")};}
  if(probe.body)await probe.body.cancel().catch(()=>{});
  return {name:crawler.name,user_agent:crawler.ua,robots_allowed:policy.allowed,robots_rule:policy.rule,http_status:probe.status,reachable:probe.ok,redirected:probe.status>=300&&probe.status<400,content_type:probe.headers.get("content-type")||"",status:policy.allowed&&probe.ok?"pass":"warning",detail:!policy.allowed?"Blocked by robots.txt policy.":probe.ok?"Page endpoint returned HTTP "+probe.status+".": "Crawler request received HTTP "+probe.status+"."};
 });
 const checks=[];
 const add=(category,label,ok,detail,extra={})=>checks.push({category,label,status:ok?"pass":"warning",detail,...extra});
 crawlerResults.forEach(c=>add("crawler",c.name,c.status==="pass",c.detail,{user_agent:c.user_agent,robots_allowed:c.robots_allowed,http_status:c.http_status,robots_rule:c.robots_rule}));
 const mainText=/<main\b/i.test(html)||/<article\b/i.test(html);
 const hasNoscript=/\<noscript\b/i.test(html);
 add("html","Readable server-delivered content",wordCount>=120&&mainText,"Approx. "+wordCount+" visible words; "+(mainText?"main/article landmark found.":"no main/article landmark detected."),{word_count:wordCount});
 add("html","HTML structure and JavaScript dependency",wordCount>=120&&(!hasNoscript||wordCount>=250),"Detected "+scripts+" script tags; "+(hasNoscript?"noscript fallback exists.":"no noscript fallback detected.")+" This is a source-HTML heuristic, not a browser rendering test.",{script_count:scripts});
 add("structured","Valid JSON-LD structured data",validJsonLd>0,validJsonLd+" valid JSON-LD block(s) found.",{valid_jsonld_blocks:validJsonLd});
 add("structured","Recognised schema types",schemaTypes.length>0,"Schema types: "+(schemaTypes.length?[...new Set(schemaTypes)].join(", "):"none detected")+".",{schema_types:[...new Set(schemaTypes)]});
 if(!options.skipSiteFiles)add("files","AI and search discovery files",robotsAvailable&&effectiveSitemapResponse?.ok===true,"robots.txt: "+(robotsAvailable?"available":"not found")+". sitemap.xml: "+(effectiveSitemapResponse?.ok?"available":"not found")+". llms.txt: "+(llmsResponse?.ok?"available":"not found")+".",{robots_available:robotsAvailable,sitemap_available:!!effectiveSitemapResponse?.ok,llms_available:!!llmsResponse?.ok,llms_excerpt:llmsText.slice(0,1200),sitemap_excerpt:sitemapText.slice(0,500)});
 add("metadata","SEO and social metadata",!!title&&!!description&&!!canonical,"Title: "+(title?"present":"missing")+". Description: "+(description?"present":"missing")+". Canonical: "+(canonical?"present":"missing")+".",{title,meta_description:description,canonical});
 add("trust","Secure delivery and index directives",target.protocol==="https:"&&!/noindex/i.test(robotsMeta),"HTTPS: "+(target.protocol==="https:"?"yes":"no")+". Robots meta: "+(robotsMeta||"not specified")+".",{robots_meta:robotsMeta});
 add("trust","Accessible image descriptions",images.length===0||missingAlt===0,missingAlt+" of "+images.length+" images lack alt attributes.",{image_count:images.length,images_missing_alt:missingAlt});
 const questionHeadings=(html.match(/<h[2-6]\b[^>]*>[^<]*(?:\?|\bwhat\b|\bwhy\b|\bhow\b|\bwhen\b|\bwhere\b|\bwho\b|\bwhich\b)[^<]*<\/h[2-6]>/gi)||[]).length;
 const answerBlocks=[...html.matchAll(/<h[2-6]\b[^>]*>[\s\S]*?<\/h[2-6]>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi)].filter(m=>{const n=m[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().split(" ").length;return n>=25&&n<=110;}).length;
 const hasFaqSchema=schemaTypes.some(type=>String(type).toLowerCase()==="faqpage");
 const faqMarkup=hasFaqSchema||(/\bfaq\b/i.test(html)&&(/<details\b/i.test(html)||/<summary\b/i.test(html)));
 const definitionSignals=(html.match(/<dfn\b|<dt\b|<abbr\b|\b(?:is defined as|refers to|means that)\b/gi)||[]).length;
 const speakable=/\bSpeakableSpecification\b/i.test(html);
 add("aeo","Question-led headings",questionHeadings>0,questionHeadings+" question-style heading(s) detected. Use headings that mirror the questions readers ask.",{question_headings:questionHeadings});
 add("aeo","Concise answer blocks",answerBlocks>0,answerBlocks+" heading-following paragraph(s) contain a concise answer-length response.",{answer_blocks:answerBlocks});
 add("aeo","FAQ structure",faqMarkup,"FAQPage schema or visible FAQ/accordion markup "+(faqMarkup?"detected":"not detected")+".",{faq_schema:hasFaqSchema});
 add("aeo","Definitions and explanatory markup",definitionSignals>0,definitionSignals+" definition-style signals found (dfn, dt, abbr or explicit definitions).",{definition_signals:definitionSignals});
 add("aeo","Speakable content hints",speakable,"SpeakableSpecification "+(speakable?"detected":"not detected")+". This is an optional, limited-use schema signal.",{speakable});
 const authorMeta=metaContent("author")||metaContent("article:author")||metaContent("parsely-author");
 const authorSchema=/\"author\"\s*:\s*(?:\{[^}]*\"@type\"\s*:\s*\"Person\"|\"[^"]+\"|\[)/i.test(html);
 const dateSignals=metaContent("article:published_time")||metaContent("date")||metaContent("article:modified_time")||/\"datePublished\"|\"dateModified\"|<time\b[^>]*datetime=/i.test(html);
 const outboundLinks=[...html.matchAll(/<a\b[^>]*href=[\"'](https?:\/\/[^\"']+)[\"'][^>]*>/gi)].map(m=>m[1]).filter(href=>{try{return new URL(href,target.href).hostname!==target.hostname}catch{return false}});
 const citationSignals=/<cite\b|\b(references|sources|further reading|works cited)\b/i.test(html)||outboundLinks.length>=2;
 const publisherSchema=schemaTypes.some(type=>["Organization","NewsMediaOrganization","Person"].includes(String(type)));
 const transparencyLinks=/(?:about|contact|editorial|ethics|standards|authors|team)/i.test(html.match(/<a\b[^>]*href=[\"'][^\"']+[\"'][^>]*>[\s\S]*?<\/a>/gi)?.join(" ")||"");
 const entitySignals=!!metaContent("og:site_name")||publisherSchema||/\"sameAs\"\s*:/i.test(html);
 add("geo","Author and publisher identity",!!(authorMeta||authorSchema)&&publisherSchema,"Author "+(authorMeta||authorSchema?"identified":"not clearly identified")+"; publisher/person schema "+(publisherSchema?"present":"not detected")+".",{author:authorMeta||null,author_schema:authorSchema,publisher_schema:publisherSchema});
 add("geo","Publication and update dates",!!dateSignals,"Publication or modification date signals "+(dateSignals?"detected":"not detected")+".",{date_signals:Boolean(dateSignals)});
 add("geo","Source citations and references",citationSignals,outboundLinks.length+" external links detected; "+(citationSignals?"citation/reference signals found":"clear source-reference signals not detected")+".",{external_links:outboundLinks.length});
 add("geo","Publisher transparency signals",transparencyLinks,"About, contact, editorial standards or author/team links "+(transparencyLinks?"detected":"not detected")+".",{transparency_links:transparencyLinks});
 add("geo","Entity and organisation context",entitySignals,"Publisher/site identity signals "+(entitySignals?"detected":"not detected")+" via site name, publisher schema or sameAs references.",{entity_signals:entitySignals});
 const categories=Object.entries(AUDIT_WEIGHTS).map(([key,weight])=>{const rows=checks.filter(c=>c.category===key),passed=rows.filter(c=>c.status==="pass").length;return {id:key,label:({crawler:"AI crawler access",html:"Readable HTML content",structured:"Structured data",files:"AI crawl files and sitemap",metadata:"SEO metadata",trust:"Trust and accessibility",aeo:"Answer Engine Optimisation (AEO)",geo:"Generative Engine Optimisation (GEO)"})[key],weight,passed,total:rows.length,score:rows.length?Math.round(passed/rows.length*100):0};});
 const score=Math.round(categories.reduce((sum,c)=>sum+c.weight*c.score/100,0));
 return {url:target.href,hostname:target.hostname,status:pageResponse.status,response_time_ms:responseTime,content_type:contentType,content_bytes:new TextEncoder().encode(html).length,title,meta_description:description,canonical,word_count:wordCount,script_count:scripts,robots_meta:robotsMeta,score,max_score:100,checks_count:checks.length,passed_count:checks.filter(c=>c.status==="pass").length,warning_count:checks.filter(c=>c.status!=="pass").length,categories,checks,crawlers:crawlerResults,robots:{available:robotsAvailable,status:robotsResponse?.status||null,excerpt:robotsText.slice(0,2000)},files:{sitemap_available:!!sitemapResponse?.ok,llms_available:!!llmsResponse?.ok},audited_at:new Date().toISOString(),limitations:["Crawler checks use representative User-Agent headers and the site's published robots.txt rules; they do not prove that a provider has indexed or will cite the page.","The audit inspects source HTML returned to the Worker. It does not execute JavaScript or verify browser-rendered content.","A robots.txt allow rule is not a guarantee of crawl access, indexing or AI-search visibility."]};
}

async function discoverAuditPages(raw,maxPages){
 const target=new URL(raw),origin=target.origin,robotsUrl=new URL("/robots.txt",origin);
 let robotsText="";
 try{const response=await publicFetch(robotsUrl,{"User-Agent":"TheSportzine-AI-Visibility-Audit/1.0","Accept":"text/plain"});if(response.ok)robotsText=await readResponseText(response,300000);}catch{}
 const groups=parseRobots(robotsText);
 const sitemapCandidates=[...robotsText.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map(m=>m[1]);
 sitemapCandidates.push(new URL("/sitemap.xml",origin).href);
 const sitemapQueue=[...new Set(sitemapCandidates)],visitedSitemaps=new Set(),found=new Set([target.href]),skipped=[];
 while(sitemapQueue.length&&visitedSitemaps.size<5&&found.size<maxPages*5){
  const sitemapUrl=sitemapQueue.shift();if(visitedSitemaps.has(sitemapUrl))continue;visitedSitemaps.add(sitemapUrl);
  let xml="";try{const sitemapTarget=new URL(sitemapUrl);if(sitemapTarget.origin!==origin)continue;const response=await publicFetch(sitemapTarget,{"User-Agent":"TheSportzine-AI-Visibility-Audit/1.0","Accept":"application/xml,text/xml"});if(!response.ok)continue;xml=await readResponseText(response,1000000);}catch{continue;}
  const locations=[...xml.matchAll(/<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi)].map(m=>decodeHtml(m[1].trim())).filter(Boolean);
  const isIndex=/<sitemapindex\b/i.test(xml);
  for(const location of locations){
   let candidate;try{candidate=new URL(location,sitemapUrl);candidate.hash="";}catch{continue;}
   if(candidate.origin!==origin||isSafePublicTarget(candidate.href).error)continue;
   if(isIndex){if(sitemapQueue.length+visitedSitemaps.size<5&&!visitedSitemaps.has(candidate.href))sitemapQueue.push(candidate.href);continue;}
   if(/\.(?:pdf|jpg|jpeg|png|gif|webp|svg|xml|zip|mp4|mp3|css|js)(?:$|\?)/i.test(candidate.pathname))continue;
   const policy=robotsDecision(groups,"TheSportzine-AI-Visibility-Audit",candidate.pathname+candidate.search);
   if(!policy.allowed){skipped.push({url:candidate.href,reason:"Blocked by robots.txt: "+policy.rule});continue;}
   found.add(candidate.href);
   if(found.size>=maxPages*5)break;
  }
 }
 const urls=[...found].slice(0,maxPages);
 return {urls,discovered:found.size,skipped,sitemaps_checked:visitedSitemaps.size,robots_available:!!robotsText};
}
function weightedPageScore(report){
 const categories=report.categories.filter(c=>!["crawler","files"].includes(c.id)&&c.total>0);
 const totalWeight=categories.reduce((n,c)=>n+c.weight,0);
 return totalWeight?Math.round(categories.reduce((n,c)=>n+c.weight*c.score/100,0)*100/totalWeight):0;
}
async function auditWholeSite(raw,maxPages=20){
 const safe=isSafePublicTarget(raw);if(safe.error)return {error:safe.error};
 const target=safe.url;
 const rootReport=await auditSiteUrl(target.href);
 if(rootReport.error)return rootReport;
 const discovery=await discoverAuditPages(target.href,maxPages);
 const urls=discovery.urls.filter(url=>url!==rootReport.url).slice(0,Math.max(0,maxPages-1));
 const scanned=await mapLimit(urls,3,async url=>{try{const report=await auditSiteUrl(url,{skipCrawlerProbes:true,skipSiteFiles:true});return report.error?{...report,url}:report;}catch(error){return {url,error:error.message||"Page audit failed"};}});
 const pageReports=[rootReport,...scanned.filter(report=>report&&!report.error)];
 const failed=scanned.filter(report=>!report||report.error);
 const checks=[
  ...rootReport.checks.filter(check=>check.category==="crawler"||check.category==="files"),
  ...pageReports.flatMap(report=>report.checks.filter(check=>check.category!=="crawler"&&check.category!=="files"))
 ];
 const categories=Object.entries(AUDIT_WEIGHTS).map(([id,weight])=>{
  const rows=checks.filter(check=>check.category===id),passed=rows.filter(check=>check.status==="pass").length;
  return {id,label:({crawler:"AI crawler access",html:"Readable HTML content",structured:"Structured data",files:"AI crawl files and sitemap",metadata:"SEO metadata",trust:"Trust and accessibility",aeo:"Answer Engine Optimisation (AEO)",geo:"Generative Engine Optimisation (GEO)"})[id],weight,passed,total:rows.length,score:rows.length?Math.round(passed/rows.length*100):0};
 });
 const score=Math.round(categories.reduce((sum,c)=>sum+c.weight*c.score/100,0));
 return {url:rootReport.url,hostname:rootReport.hostname,score,max_score:100,categories,checks,checks_count:checks.length,passed_count:checks.filter(c=>c.status==="pass").length,warning_count:checks.filter(c=>c.status!=="pass").length,pages_discovered:discovery.discovered,pages_crawled:pageReports.length,pages_skipped:discovery.skipped.length+failed.length,page_limit:maxPages,pages:pageReports.map(report=>({url:report.url,title:report.title,word_count:report.word_count,status:report.status,score:weightedPageScore(report),checks_count:report.checks.filter(c=>!["crawler","files"].includes(c.category)).length,warning_count:report.checks.filter(c=>!["crawler","files"].includes(c.category)&&c.status!=="pass").length})),skipped_pages:[...discovery.skipped,...failed.map(report=>({url:report?.url||"Unknown",reason:report?.error||"Page could not be audited"}))].slice(0,50),crawler_summary:rootReport.crawlers.map(c=>({name:c.name,status:c.status,robots_allowed:c.robots_allowed,http_status:c.http_status})),audited_at:new Date().toISOString(),limitations:["Crawler access and discovery-file checks are performed once for the site origin; page-level content checks are sampled from sitemap URLs.","Only same-origin URLs discovered in up to five sitemap files are considered. The scan is capped at the requested page limit and does not crawl arbitrary internal links.","The report evaluates technical and editorial readiness signals. It does not establish AI provider indexing, citations, rankings or traffic."]};
}
function auditPrepublishDraft(input){
 const title=String(input.title||"").trim().slice(0,240);
 const raw=String(input.content||"").slice(0,60000);
 const author=String(input.author||"").trim().slice(0,120);
 const publisher=String(input.publisher||"The Sportzine").trim().slice(0,120);
 const articleUrl=String(input.url||"").trim().slice(0,2048);
 const sourceUrls=String(input.source_urls||"").split(/\r?\n|,/).map(x=>x.trim()).filter(x=>/^https?:\/\//i.test(x));
 const entities=String(input.entities||"").split(/,|\n/).map(x=>x.trim()).filter(Boolean).slice(0,20);
 const html=raw.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi," ");
 const text=decodeHtml(html.replace(/<[^>]+>/g," ").replace(/\s+/g," ")).trim();
 const words=text?text.split(/\s+/).filter(Boolean):[];
 const headings=[...raw.matchAll(/<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/gi)].map(m=>decodeHtml(m[1].replace(/<[^>]+>/g," ")).trim()).concat([...raw.matchAll(/^#{2,6}\s+(.+)$/gm)].map(m=>m[1].trim()));
 const plainParagraphs=raw.includes("<p")?[...raw.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>decodeHtml(m[1].replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()).filter(Boolean):raw.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
 const paragraphWords=plainParagraphs.map(p=>p.split(/\s+/).filter(Boolean).length);
 const leadWords=paragraphWords[0]||0,averageParagraph=paragraphWords.length?Math.round(paragraphWords.reduce((a,b)=>a+b,0)/paragraphWords.length):0;
 const questionHeadings=headings.filter(h=>/\?|^(what|why|how|when|where|who|which)\b/i.test(h)).length;
 const urlsInDraft=[...raw.matchAll(/https?:\/\/[^\s<>"')]+/gi)].map(m=>m[0]);
 const citations=[...new Set([...sourceUrls,...urlsInDraft])];
 const hasDate=!!String(input.published_at||"").trim();
 const entityCoverage=entities.filter(entity=>text.toLowerCase().includes(entity.toLowerCase()));
 const checks=[];
 const add=(category,label,ok,detail,weight)=>checks.push({category,label,status:ok?"pass":"warning",detail,weight});
 add("metadata","Headline length",title.length>=30&&title.length<=75,title.length+" characters; target 30–75 characters.",1);
 add("metadata","Article URL and canonical target",!!articleUrl&&!isSafePublicTarget(articleUrl).error,articleUrl?(isSafePublicTarget(articleUrl).error?"Invalid article URL: "+isSafePublicTarget(articleUrl).error:"A valid public HTTP/HTTPS article URL was supplied."):"No article URL supplied; add the canonical URL before publishing.",1);
 add("structure","Subheadings and content hierarchy",headings.length>=2,headings.length+" H2–H6 headings detected; aim for at least two meaningful sections.",1);
 add("structure","Paragraph readability",paragraphWords.length>0&&averageParagraph<=100&&Math.max(...paragraphWords)<=180,"Average paragraph: "+averageParagraph+" words; longest: "+(Math.max(0,...paragraphWords))+". Keep paragraphs concise and scannable.",1);
 add("aeo","Direct, self-contained opening",leadWords>=25&&leadWords<=100,"Opening paragraph: "+leadWords+" words; aim for a clear 25–100-word summary that answers the main news point.",2);
 add("aeo","Question-led subheadings",questionHeadings>0,questionHeadings+" question-led headings detected. Add a natural reader-question heading where useful.",1);
 add("aeo","FAQ or explanatory answers",/\bFAQ\b/i.test(raw)||/<details\b/i.test(raw)||/<summary\b/i.test(raw)||/\b(who|what|when|where|why|how)\b/i.test(headings.join(" ")), "FAQ or explanatory question structure "+( /\bFAQ\b/i.test(raw)||/<details\b/i.test(raw)||/<summary\b/i.test(raw)?"detected":"not clearly detected")+". Only add FAQs when they answer genuine reader questions.",1);
 add("aeo","Clear subject and key entities",entities.length>0&&entityCoverage.length===entities.length,entities.length?entityCoverage.length+" of "+entities.length+" supplied key entities appear in the draft.":"No key entities supplied; add the main clubs, players, competition or event.",2);
 add("geo","Named author",!!author,author?"Author supplied: "+author+".":"Add a named author or an explicit newsroom byline.",1);
 add("geo","Publisher identity",!!publisher,publisher?"Publisher supplied: "+publisher+".":"Identify the publishing organisation.",1);
 add("geo","Source references",citations.length>0,citations.length+" source URL(s) supplied or detected. Link to primary sources and original reporting where possible.",2);
 add("geo","Publication date",hasDate,"Publication date "+(hasDate?"supplied.":"not supplied; populate datePublished when publishing.") ,1);
 add("geo","Entity consistency",entities.length>0&&entityCoverage.length===entities.length,entities.length?entityCoverage.length+"/"+entities.length+" key entities appear in the copy.":"Supply key entities to verify that the article consistently names its subjects.",1);
 const categoryWeights={metadata:15,structure:15,aeo:35,geo:35};
 const categories=Object.entries(categoryWeights).map(([id,weight])=>{const rows=checks.filter(c=>c.category===id),passed=rows.filter(c=>c.status==="pass").length;return{id,label:({metadata:"Metadata",structure:"Content structure",aeo:"Answer Engine Optimisation (AEO)",geo:"Generative Engine Optimisation (GEO)"})[id],weight,passed,total:rows.length,score:Math.round(passed/rows.length*100)};});
 const score=Math.round(categories.reduce((sum,c)=>sum+c.weight*c.score/100,0));
 const publishedAt=String(input.published_at||"").trim();
 const schema={ "@context":"https://schema.org","@type":"NewsArticle",headline:title,author:author?{"@type":"Person",name:author}:undefined,publisher:publisher?{"@type":"Organization",name:publisher}:undefined,datePublished:publishedAt||undefined,mainEntityOfPage:articleUrl?{"@type":"WebPage","@id":articleUrl}:undefined};
 Object.keys(schema).forEach(key=>schema[key]===undefined&&delete schema[key]);
 return {score,max_score:100,title,word_count:words.length,paragraph_count:paragraphWords.length,heading_count:headings.length,question_heading_count:questionHeadings,citation_count:citations.length,citations,entities,entity_coverage:entityCoverage,categories,checks,checks_count:checks.length,passed_count:checks.filter(c=>c.status==="pass").length,warning_count:checks.filter(c=>c.status!=="pass").length,suggested_jsonld:schema,audited_at:new Date().toISOString(),limitations:["This is a deterministic editorial and markup checklist, not an AI-generated fact check or legal review.","The checker cannot verify whether a source supports a claim; editors must open and validate every citation.","FAQ, Speakable and structured-data enhancements should only be published when they accurately represent visible page content and current search-engine policies."]};
}

function canonicalLink(link) {
  try { const u = new URL(link); return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")).toLowerCase(); }
  catch { return String(link || "").toLowerCase(); }
}
function headlineKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).slice(0, 10).join(" ");
}
async function loadAllFeeds(env, fresh) {
  const configured = await getConfiguredFeeds(env);
  return Promise.all(configured.map(async feed => ({ feed, ...await getFeed(feed, { fresh }) })));
}
function groupStories(items) {
  const byLink = new Map(), byHeadline = new Map(), stories = [];
  for (const story of items) {
    const linkKey = canonicalLink(story.link), titleKey = headlineKey(story.title);
    const existing = byLink.get(linkKey) || byHeadline.get(titleKey);
    if (existing) {
      // The same article listed in two of one publisher's feeds is not a second source.
      if (!existing.sources.includes(story.source)) { existing.sources.push(story.source); existing.duplicateCount = existing.sources.length; }
      if (story.breaking) existing.breaking = existing.priority = true;
      byLink.set(linkKey, existing);
      continue;
    }
    const grouped = { ...story, sources: [story.source], duplicateCount: 1 };
    byLink.set(linkKey, grouped); byHeadline.set(titleKey, grouped); stories.push(grouped);
  }
  return stories.sort((a, b) => b.timestamp - a.timestamp);
}
async function fetchStories(env, { fresh = false } = {}) {
  const results = await loadAllFeeds(env, fresh);
  return {
    stories: groupStories(results.flatMap(result => result.items)),
    feeds: results.map(({ feed, items, error, diagnostic }) => ({ name: feed.name, sport: feed.sport, count: items.length, error, diagnostic })),
    fetched_at: new Date().toISOString()
  };
}
function keywordTerms(keyword) {
  return keyword.split(",").map(term => term.trim().toLocaleLowerCase()).filter(Boolean);
}
async function searchStories(env, keyword) {
  const results = await loadAllFeeds(env, false);
  const terms = keywordTerms(keyword);
  const matchesTerms = story => { const text = (story.title + " " + story.summary).toLocaleLowerCase(); return terms.some(term => text.includes(term)); };
  return {
    keyword,
    terms,
    stories: groupStories(results.flatMap(result => result.items).filter(matchesTerms)).slice(0, 100),
    feeds: results.map(({ feed, items, error }) => ({ name: feed.name, count: items.length, matches: items.filter(matchesTerms).length, error })),
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
  return !isSafePublicTarget(String(value || "")).error;
}
function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
// Write protection for source management and saved stories.
// If the STUDIO_WRITE_KEY secret is set, every write must send it in X-Studio-Key.
// Without the secret, writes must at least come from an allowed browser origin.
function writeDenied(request, env, origin) {
  if (env.STUDIO_WRITE_KEY) {
    const supplied = request.headers.get("X-Studio-Key") || "";
    if (!supplied || !timingSafeEqual(supplied, env.STUDIO_WRITE_KEY)) return json({ error: "This change needs the Studio write key. Add it under Newsroom settings.", auth_required: true }, 401, origin);
    return null;
  }
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Changes are only accepted from the Studio app." }, 403, origin);
  return null;
}
const LINK_BASE = "https://link.falsewinger.com";
const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;
const LINK_LIST_LIMIT = 500;
const LINK_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randomLinkCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, b => LINK_ALPHABET[b % LINK_ALPHABET.length]).join("");
}
function cleanLinkTarget(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.href;
  } catch { return ""; }
}
function cleanPreviewImage(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.length > 2048) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.href;
  } catch { return undefined; }
}
const SAVED_STORY_LIMIT = 1000;
function cleanSavedStory(input) {
  if (!input || typeof input !== "object") return null;
  const text = (value, max) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const story = {
    id: text(input.id, 2048), title: text(input.title, 400), summary: text(input.summary, 700), link: text(input.link, 2048),
    source: text(input.source, 120), sport: text(input.sport, 60), published: text(input.published, 80),
    timestamp: Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : 0,
    breaking: Boolean(input.breaking), priority: Boolean(input.priority),
    sources: Array.isArray(input.sources) ? input.sources.map(x => text(x, 120)).filter(Boolean).slice(0, 20) : [],
    duplicateCount: Math.max(1, Math.min(50, Number(input.duplicateCount) || 1))
  };
  if (!story.id || !story.title || !/^https?:\/\//i.test(story.link)) return null;
  return story;
}
async function listSources(db) {
  // Keep the Sources page useful when the Cloudflare D1 binding is absent.
  // Built-in feeds are available without persistence; custom source management
  // remains disabled until the DB binding is configured.
  if (!db) return DEFAULT_FEEDS.map((feed,index)=>({
    id:"builtin-"+index,name:feed.name,feed_url:feed.url,sport:feed.sport,
    priority:1,enabled:true,is_default:true
  }));
  await ensureNewsroomSchema(db);
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

async function auditSeoPublicUrl(raw,options={}) {
  const safe=isSafePublicTarget(raw);if(safe.error)return {error:safe.error};
  let target=safe.url,response;
  for(let hop=0;hop<=5;hop++){
    response=await publicFetch(target,{"User-Agent":"Newsroom-SEO-Analyzer/1.0 (+https://newsroom.falsewinger.com)","Accept":"text/html,application/xhtml+xml"},12000);
    if(response.status>=300&&response.status<400){
      const location=response.headers.get("location");
      if(!location)return {error:"The website returned a redirect without a destination."};
      if(hop===5)return {error:"The page exceeded the redirect limit."};
      const next=isSafePublicTarget(new URL(location,target).href);if(next.error)return {error:next.error};
      target=next.url;continue;
    }
    break;
  }
  if(!response?.ok)return {error:"The website returned HTTP "+(response?.status||"unknown")+"."};
  const type=response.headers.get("content-type")||"";
  if(!/text\/html|application\/xhtml\+xml/i.test(type))return {error:"The URL did not return an HTML page."};
  const html=await readResponseText(response,2*1024*1024);
  const attr=(tag,name)=>extractHtmlAttribute(tag,name);
  const meta=(name)=>{for(const tag of html.match(/<meta\b[^>]*>/gi)||[])if(attr(tag,"name").toLowerCase()===name.toLowerCase())return attr(tag,"content");return "";};
  const titleMatch=html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title=titleMatch?decodeHtml(titleMatch[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()):"";
  const description=meta("description");
  const links=html.match(/<link\b[^>]*>/gi)||[];
  const canonicalTag=links.find(tag=>attr(tag,"rel").toLowerCase().split(/\s+/).includes("canonical"));
  let canonical="";try{canonical=canonicalTag?new URL(attr(canonicalTag,"href"),target).href:"";}catch{}
  const headings=[...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map(m=>({level:Number(m[1]),text:decodeHtml(m[2].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()).slice(0,240)}));
  const body=(html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)||[null,html])[1];
  const text=decodeHtml(body.replace(/<(script|style|noscript|svg|template|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());
  const wordCount=text?text.split(/\s+/).length:0;
  const paragraphs=[...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(m=>m[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()).filter(Boolean);
  const schemas=[];
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
    try{const parsed=JSON.parse(match[1]);const visit=value=>{if(!value||typeof value!=="object")return;if(Array.isArray(value))return value.forEach(visit);const type=value["@type"];if(type)(Array.isArray(type)?type:[type]).forEach(x=>schemas.push(String(x)));Object.values(value).forEach(visit);};visit(parsed);}catch{}
  }
  const uniqueSchemas=[...new Set(schemas)],h1=headings.filter(h=>h.level===1).length;
  const images=html.match(/<img\b[^>]*>/gi)||[],linksCount=(html.match(/<a\b[^>]*href\s*=/gi)||[]).length;
  const robots=(meta("robots")+" "+meta("googlebot")).toLowerCase();
  const questions=(text.match(/\?/g)||[]).length,faq=/frequently asked questions|\bfaqs?\b/i.test(text)||uniqueSchemas.some(x=>["FAQPage","QAPage"].includes(x));
  const answerParagraph=paragraphs.some(p=>{const n=p.split(/\s+/).length;return n>=20&&n<=90;});
  const originUrl=new URL(target.origin);
  const [robotsResponse,sitemapResponse,llmsResponse]=options.skipSiteFiles?[null,null,null]:await Promise.all([
    publicFetch(new URL("/robots.txt",originUrl),{"User-Agent":"Studio-SEO-Audit/1.0","Accept":"text/plain"},5000).catch(()=>null),
    publicFetch(new URL("/sitemap.xml",originUrl),{"User-Agent":"Studio-SEO-Audit/1.0","Accept":"application/xml,text/xml"},5000).catch(()=>null),
    publicFetch(new URL("/llms.txt",originUrl),{"User-Agent":"Studio-SEO-Audit/1.0","Accept":"text/plain"},5000).catch(()=>null)
  ]);
  let effectiveSitemapResponse=sitemapResponse;
  if(!effectiveSitemapResponse?.ok){
    for(const path of ["/sitemap_index.xml","/wp-sitemap.xml"]){
      const candidate=await publicFetch(new URL(path,originUrl),{"User-Agent":"Studio-SEO-Audit/1.0","Accept":"application/xml,text/xml"},4000).catch(()=>null);
      if(candidate?.ok){effectiveSitemapResponse=candidate;break;}
    }
  }
  const robotsText=robotsResponse?.ok?await readResponseText(robotsResponse,200000).catch(()=>""):"";
  const sitemapText=effectiveSitemapResponse?.ok?await readResponseText(effectiveSitemapResponse,300000).catch(()=>""):"";
  const llmsText=llmsResponse?.ok?await readResponseText(llmsResponse,100000).catch(()=>""):"";
  const robotsPolicy=robotsResponse?.ok?robotsDecision(parseRobots(robotsText),"Googlebot",target.pathname+target.search):{allowed:true,rule:"robots.txt unavailable; policy could not be checked."};
  const propertyMeta=(property)=>{for(const tag of html.match(/<meta\b[^>]*>/gi)||[])if(extractHtmlAttribute(tag,"property").toLowerCase()===property.toLowerCase())return extractHtmlAttribute(tag,"content");return "";};
  const ogTitle=propertyMeta("og:title"),ogDescription=propertyMeta("og:description"),ogImage=propertyMeta("og:image");
  const twitterCard=meta("twitter:card")||propertyMeta("twitter:card");
  const imageAltMissing=images.filter(tag=>! /\balt\s*=/i.test(tag)).length;
  const imageAltEmpty=images.filter(tag=>/\balt\s*=\s*["']\s*["']/i.test(tag)).length;
  const imageWithoutDimensions=images.filter(tag=>! /\bwidth\s*=/i.test(tag)||! /\bheight\s*=/i.test(tag)).length;
  const lazyImages=images.filter(tag=>/\bloading\s*=\s*["']lazy["']/i.test(tag)).length;
  const anchorTags=html.match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi)||[];
  const emptyAnchors=anchorTags.filter(tag=>!decodeHtml(tag.replace(/<[^>]+>/g," ").trim())&&!/\baria-label\s*=/i.test(tag)&&!/<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(tag)).length;
  const anchorsWithoutHref=anchorTags.filter(tag=>! /\bhref\s*=/i.test(tag)).length;
  const hrefs=[...html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)].map(m=>m[2]).filter(Boolean);
  const resolvedLinks=hrefs.map(href=>{try{return new URL(href,target)}catch{return null}}).filter(Boolean);
  const internalLinks=resolvedLinks.filter(link=>link.origin===target.origin);
  const externalLinks=resolvedLinks.filter(link=>link.origin!==target.origin&&/^https?:$/.test(link.protocol));
  const schemaBlocks=[...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m=>m[1]);
  let validSchemaBlocks=0,invalidSchemaBlocks=0,schemaObjects=[];
  for(const rawSchema of schemaBlocks){try{const parsed=JSON.parse(rawSchema);validSchemaBlocks++;const walk=value=>{if(!value||typeof value!=="object")return;if(Array.isArray(value))return value.forEach(walk);schemaObjects.push(value);Object.values(value).forEach(walk)};walk(parsed);}catch{invalidSchemaBlocks++;}}
  const articleSchema=schemaObjects.find(obj=>{const t=Array.isArray(obj["@type"])?obj["@type"]:[obj["@type"]];return t.some(x=>["Article","NewsArticle","BlogPosting"].includes(String(x)))});
  const organizationSchema=schemaObjects.find(obj=>{const t=Array.isArray(obj["@type"])?obj["@type"]:[obj["@type"]];return t.includes("Organization")||t.includes("NewsMediaOrganization")});
  const authorSchema=articleSchema?.author;
  const hasAuthor=!!(authorSchema&&(typeof authorSchema==="string"||authorSchema.name||authorSchema["@id"]));
  const hasPublisher=!!(articleSchema?.publisher&&(typeof articleSchema.publisher==="string"||articleSchema.publisher.name||articleSchema.publisher["@id"]))||!!organizationSchema;
  const hasPublishedDate=!!(articleSchema?.datePublished);
  const hasModifiedDate=!!(articleSchema?.dateModified);
  const hasArticleHeadline=!!(articleSchema?.headline);
  const hasMainEntity=!!(articleSchema?.mainEntityOfPage);
  const canonicalResolved=canonical?(()=>{try{return new URL(canonical,target).href}catch{return ""}})():"";
  const canonicalMatches=!!canonicalResolved&&new URL(canonicalResolved).origin===target.origin&&new URL(canonicalResolved).pathname.replace(/\/$/,"")===target.pathname.replace(/\/$/,"");
  const hasAboutContact=/\b(about|contact|editorial|standards|corrections)\b/i.test(hrefs.map(h=>{try{return new URL(h,target).pathname}catch{return h}}).join(" "));
  const checks={
    seo:[
      {ok:title.length>=30&&title.length<=60,name:"Title tag",detail:title?title.length+" characters; aim for around 30–60.":"No title tag found."},
      {ok:description.length>=120&&description.length<=160,name:"Meta description",detail:description?description.length+" characters; aim for around 120–160.":"No meta description found."},
      {ok:h1===1,name:"Single H1 heading",detail:h1+" H1 headings found."},
      {ok:headings.length>=2,name:"Heading hierarchy",detail:headings.length+" headings detected."},
      {ok:!!canonical,name:"Canonical URL",detail:canonical?"Canonical URL is declared.":"No canonical link found."},
      {ok:!robots.includes("noindex"),name:"Indexability directive",detail:robots.includes("noindex")?"A noindex directive was detected.":"No noindex directive detected."},
      {ok:/name\s*=\s*["']viewport["']/i.test(html),name:"Mobile viewport",detail:/name\s*=\s*["']viewport["']/i.test(html)?"Viewport metadata is present.":"Add a responsive viewport meta tag."},
      {ok:images.every(tag=>/\balt\s*=/i.test(tag)),name:"Image alt attributes",detail:images.filter(tag=>!/\balt\s*=/i.test(tag)).length+" of "+images.length+" images have missing alt text."},
      {ok:linksCount>0,name:"Links",detail:linksCount+" links detected in the HTML."},
      {ok:wordCount>=300,name:"Main content depth",detail:wordCount+" visible words extracted; context matters more than a fixed length."},
      {ok:!!ogTitle&&!!ogDescription&&!!ogImage,name:"Open Graph metadata",detail:"og:title: "+(ogTitle?"present":"missing")+". og:description: "+(ogDescription?"present":"missing")+". og:image: "+(ogImage?"present":"missing")+". This improves social sharing previews."},
      {ok:!!twitterCard,name:"X/Twitter card metadata",detail:twitterCard?"twitter:card is set to "+twitterCard+".":"Add a twitter:card meta tag, typically summary_large_image for article pages."}
    ],
    aeo:[
      {ok:wordCount>=120,name:"Answer context",detail:wordCount+" visible words extracted."},
      {ok:headings.length>=2,name:"Question-friendly structure",detail:headings.length+" headings detected."},
      {ok:questions>0||faq,name:"Questions and FAQs",detail:questions+" question marks detected; FAQ content "+(faq?"found.":"not found.")},
      {ok:answerParagraph,name:"Extractable answer paragraphs",detail:answerParagraph?"A 20–90 word paragraph was found.":"No concise extractable answer paragraph detected."},
      {ok:headings.some(h=>[2,3].includes(h.level)),name:"Semantic subheadings",detail:"H2/H3 sections "+(headings.some(h=>[2,3].includes(h.level))?"are present.":"are missing.")},
      {ok:uniqueSchemas.some(x=>["Article","NewsArticle","BlogPosting","FAQPage","QAPage","HowTo"].includes(x)),name:"Relevant structured data",detail:uniqueSchemas.length?uniqueSchemas.join(", "):"No JSON-LD schema types detected."}
    ],
    geo:[
      {ok:/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}\b/.test(text),name:"Named entities",detail:"Use explicit names for people, organisations and places."},
      {ok:/\b(according to|said|told|reported by|confirmed by|announced by|source:|via )\b/i.test(text),name:"Source attribution",detail:"Attribute reporting, quotes and claims to identifiable sources."},
      {ok:/\b\d+(?:[.,]\d+)?\s*(?:%|percent|million|billion|thousand|years?|days?)?\b/i.test(text),name:"Evidence and specifics",detail:"Include verifiable figures and concrete details where relevant."},
      {ok:/\b(?:20\d{2}|yesterday|today|on monday|on tuesday|on wednesday|on thursday|on friday|on saturday|on sunday)\b/i.test(text),name:"Temporal context",detail:"Make publication and event timing explicit."},
      {ok:headings.length>=2,name:"Information hierarchy",detail:headings.length+" headings detected."},
      {ok:/\b(after|before|since|because|following|while|during|compared with|in the context of)\b/i.test(text),name:"Context and relationships",detail:"Explain why the event happened and how it connects to the wider topic."},
      {ok:uniqueSchemas.length>0,name:"Machine-readable entities",detail:uniqueSchemas.length?"Schema types: "+uniqueSchemas.join(", "):"No JSON-LD structured data detected."},
      {ok:!!title&&!!description,name:"Clear page framing",detail:title&&description?"Title and description are both present.":"Title or description is missing."}
    ],
    technical:[
      {ok:!!robotsResponse?.ok,name:"robots.txt availability",detail:robotsResponse?.ok?"robots.txt is reachable.":"robots.txt could not be fetched successfully."},
      {ok:!!sitemapResponse?.ok,name:"XML sitemap availability",detail:sitemapResponse?.ok?"sitemap.xml is reachable.":"No accessible /sitemap.xml was found; verify the sitemap URL in robots.txt."},
      {ok:!robots.includes("noindex")&&!/\bnoindex\b/i.test(robotsText),name:"Indexing directives",detail:robots.includes("noindex")?"A noindex directive appears in page metadata.":/\bnoindex\b/i.test(robotsText)?"A noindex directive appears in robots.txt.":"No noindex directive detected in page metadata or robots.txt."},
      {ok:robotsPolicy.allowed,name:"Googlebot robots.txt access",detail:robotsPolicy.rule},
      {ok:!!canonicalResolved,name:"Canonical URL validity",detail:canonicalResolved?"Canonical resolves to "+canonicalResolved: "Canonical URL is missing or invalid."},
      {ok:canonicalMatches,name:"Canonical consistency",detail:canonicalMatches?"Canonical points to this page.":canonicalResolved?"Canonical points to a different URL; verify that this is intentional.":"A valid canonical URL was not detected."},
      {ok:/name\s*=\s*["']viewport["']/i.test(html),name:"Mobile viewport",detail:/name\s*=\s*["']viewport["']/i.test(html)?"Viewport meta tag is present.":"Add a responsive viewport meta tag."},
      {ok:!/<meta\b[^>]*http-equiv=["']refresh["']/i.test(html),name:"HTML redirect usage",detail:/<meta\b[^>]*http-equiv=["']refresh["']/i.test(html)?"Meta refresh redirect detected; use a server-side redirect where appropriate.":"No meta refresh redirect detected."},
      {ok:!!response.headers.get("content-type")?.toLowerCase().includes("charset=utf-8")||/charset=["']?utf-8/i.test(html.slice(0,2000)),name:"Character encoding",detail:"Content-Type: "+(response.headers.get("content-type")||"not supplied")+". Check that UTF-8 is declared."},
      {ok:!!response.headers.get("strict-transport-security"),name:"HSTS response header",detail:response.headers.get("strict-transport-security")?"Strict-Transport-Security header is present.":"HSTS header not observed; configure it at the HTTPS edge if appropriate."}
    ],
    structured:[
      {ok:validSchemaBlocks>0,name:"Valid JSON-LD syntax",detail:validSchemaBlocks+" valid JSON-LD block(s); "+invalidSchemaBlocks+" invalid block(s)."},
      {ok:invalidSchemaBlocks===0,name:"JSON-LD parse errors",detail:invalidSchemaBlocks+" invalid JSON-LD block(s) detected."},
      {ok:!!articleSchema,name:"Article / NewsArticle schema",detail:articleSchema?"Article-type schema detected.":"Add accurate Article or NewsArticle schema for editorial content."},
      {ok:hasArticleHeadline,name:"Schema headline",detail:hasArticleHeadline?"Article schema contains a headline.":"Article schema headline is missing."},
      {ok:hasAuthor,name:"Schema author identity",detail:hasAuthor?"Article author is identified in structured data.":"Add a named Person or Organization author to Article schema."},
      {ok:hasPublisher,name:"Schema publisher identity",detail:hasPublisher?"Publisher or Organization schema detected.":"Add publisher identity to Article schema and site-wide Organization schema."},
      {ok:hasPublishedDate,name:"Schema publication date",detail:hasPublishedDate?"datePublished is present.":"Add an accurate datePublished value."},
      {ok:hasModifiedDate,name:"Schema modification date",detail:hasModifiedDate?"dateModified is present.":"Add dateModified when the article is materially updated."},
      {ok:hasMainEntity,name:"Schema canonical entity",detail:hasMainEntity?"mainEntityOfPage is present.":"Connect the Article entity to its canonical page using mainEntityOfPage."}
    ],
    content:[
      {ok:wordCount>=250,name:"Readable content volume",detail:wordCount+" visible words extracted; use editorial judgement rather than padding to a target."},
      {ok:h1===1,name:"Single primary heading",detail:h1+" H1 heading(s) found."},
      {ok:headings.every((h,i)=>i===0||h.level<=headings[i-1].level+1),name:"Heading hierarchy",detail:"Detected "+headings.length+" headings; avoid skipping heading levels."},
      {ok:!/(.)\1{7,}/i.test(text),name:"Repeated-character noise",detail:"Check the article body for accidental repeated characters or formatting debris."},
      {ok:paragraphs.length>0,name:"Paragraph structure",detail:paragraphs.length+" paragraph blocks detected in the article body."},
      {ok:!/<title[^>]*>\s*untitled/i.test(html),name:"Placeholder content",detail:"Check for placeholder or template text before publication."}
    ],
    images:[
      {ok:images.length===0||imageAltMissing===0,name:"Image alt attributes",detail:imageAltMissing+" of "+images.length+" images are missing alt attributes."},
      {ok:imageAltEmpty===0,name:"Non-empty image descriptions",detail:imageAltEmpty+" images have empty alt attributes; use empty alt only for decorative images."},
      {ok:images.length===0||imageWithoutDimensions===0,name:"Image dimensions",detail:imageWithoutDimensions+" of "+images.length+" images lack width or height attributes."},
      {ok:images.length===0||lazyImages>0,name:"Lazy loading",detail:lazyImages+" of "+images.length+" images use loading=lazy. Keep the likely LCP/hero image eager."},
      {ok:images.every(tag=>!/(?:src|srcset)\s*=\s*["'][^"']+\.(?:bmp|tiff?)(?:[?#][^"']*)?["']/i.test(tag),name:"Modern image formats",detail:"Review large images and prefer AVIF or WebP where supported."}
    ],
    links:[
      {ok:internalLinks.length>0,name:"Internal linking",detail:internalLinks.length+" same-origin links detected."},
      {ok:externalLinks.length>0,name:"External references",detail:externalLinks.length+" external HTTP(S) links detected."},
      {ok:emptyAnchors===0,name:"Descriptive link names",detail:emptyAnchors+" links have no readable anchor text, aria-label or image alt text."},
      {ok:anchorsWithoutHref===0,name:"Anchor destinations",detail:anchorsWithoutHref+" anchor elements have no href attribute."}
    ],
    trust:[
      {ok:hasAuthor,name:"Author attribution",detail:hasAuthor?"A named author is present in Article schema.":"No structured author identity detected; make the byline visible and add author schema."},
      {ok:hasPublisher,name:"Publisher identity",detail:hasPublisher?"Publisher or organisation identity is present.":"Add a clear publisher identity in structured data."},
      {ok:hasPublishedDate,name:"Publication date transparency",detail:hasPublishedDate?"datePublished is present in Article schema.":"Provide a visible publication date and matching schema datePublished."},
      {ok:hasModifiedDate,name:"Update transparency",detail:hasModifiedDate?"dateModified is present.":"Add dateModified when the article is updated."},
      {ok:hasAboutContact,name:"Publisher transparency links",detail:hasAboutContact?"About, contact or editorial policy links detected.":"Link to About, Contact and editorial standards pages where available."}
    ],
    discovery:[
      {ok:!!robotsResponse?.ok,name:"robots.txt",detail:robotsResponse?.ok?"robots.txt is available.":"robots.txt was not found at the site root."},
      {ok:!!sitemapResponse?.ok,name:"XML sitemap",detail:sitemapResponse?.ok?"sitemap.xml is available.":"sitemap.xml was not found at the site root."},
      {ok:!!llmsResponse?.ok,name:"llms.txt",detail:llmsResponse?.ok?"llms.txt is available.":"llms.txt was not found at the site root; it is optional and not a search-engine requirement."},
      {ok:!!llmsText.trim(),name:"llms.txt content",detail:llmsText.trim()?"llms.txt contains "+llmsText.trim().length+" characters.":"No readable llms.txt content found."}
    ]
  };
  const score=items=>Math.round(items.filter(x=>x.ok).length/Math.max(1,items.length)*100);
  const categoryScores=Object.fromEntries(Object.entries(checks).map(([key,items])=>[key,score(items)]));
  const priorityFixes=Object.entries(checks).flatMap(([category,items])=>items.filter(item=>!item.ok).map(item=>({category,name:item.name,detail:item.detail,priority:["technical","structured"].includes(category)?"high":["images","links","trust"].includes(category)?"medium":"normal"}))).sort((a,b)=>({high:0,medium:1,normal:2}[a.priority]-{high:0,medium:1,normal:2}[b.priority]));
  return {url:target.href,status:response.status,auditedAt:new Date().toISOString(),title,metaDescription:description,canonical,wordCount,headingCount:headings.length,headings,schemaTypes:uniqueSchemas,metrics:{images:images.length,imagesMissingAlt:imageAltMissing,internalLinks:internalLinks.length,externalLinks:externalLinks.length,validJsonLdBlocks:validSchemaBlocks,invalidJsonLdBlocks:invalidSchemaBlocks},scores:{seo:score(checks.seo),aeo:score(checks.aeo),geo:score(checks.geo)},categoryScores,priorityFixes,checks};
}


async function auditSeoWholeSite(raw,maxPages=10){
  const safe=isSafePublicTarget(raw);if(safe.error)return {error:safe.error};
  const discovery=await discoverAuditPages(safe.url.href,maxPages);
  const urls=discovery.urls.slice(0,maxPages);
  if(!urls.length)urls.push(safe.url.href);
  const reports=await mapLimit(urls,3,async(url,index)=>{
    try{return await auditSeoPublicUrl(url,{skipSiteFiles:index>0});}
    catch(error){return {error:error.message||"Page audit failed",url};}
  });
  const successful=reports.filter(report=>report&&!report.error);
  const failed=reports.filter(report=>!report||report.error);
  if(!successful.length)return {error:"No sitemap pages could be audited. Check the sitemap and public page access."};
  const categoryIds=[...new Set(successful.flatMap(report=>Object.keys(report.checks||{})))];
  const labels={seo:"On-page SEO",technical:"Technical SEO",structured:"Structured data",content:"Content quality",images:"Image SEO",links:"Internal and external links",trust:"E-E-A-T and publisher trust",discovery:"Search and AI discovery",aeo:"Answer Engine Optimisation",geo:"Generative Engine Optimisation"};
  const categories=categoryIds.map(id=>{
    const rows=successful.flatMap(report=>(report.checks?.[id]||[]));
    const passed=rows.filter(item=>item.ok).length;
    return {id,label:labels[id]||id,score:rows.length?Math.round(passed/rows.length*100):0,passed,total:rows.length};
  });
  const grouped=new Map();
  for(const report of successful)for(const [category,items] of Object.entries(report.checks||{}))for(const item of items){
    if(item.ok)continue;
    const key=category+"|"+item.name;
    const row=grouped.get(key)||{category,label:item.name,status:"warning",detail:item.detail,affected_pages:[],priority:["technical","structured"].includes(category)?"high":["images","links","trust"].includes(category)?"medium":"normal"};
    row.affected_pages.push(report.url);grouped.set(key,row);
  }
  const fixes=[...grouped.values()].sort((a,b)=>({high:0,medium:1,normal:2}[a.priority]-{high:0,medium:1,normal:2}[b.priority])||b.affected_pages.length-a.affected_pages.length);
  const score=categories.length?Math.round(categories.reduce((sum,item)=>sum+item.score,0)/categories.length):0;
  return {url:safe.url.href,score,max_score:100,categories,checks:fixes,warning_count:fixes.length,pages_discovered:discovery.discovered||urls.length,pages_crawled:successful.length,pages_skipped:(discovery.skipped||[]).length+failed.length,page_limit:maxPages,pages:successful.map(report=>({url:report.url,title:report.title,word_count:report.wordCount,warning_count:Object.values(report.checks||{}).flat().filter(item=>!item.ok).length,scores:report.scores})),skipped_pages:[...(discovery.skipped||[]),...failed.map(report=>({url:report?.url||"Unknown",reason:report?.error||"Page could not be audited"}))].slice(0,50),audited_at:new Date().toISOString(),limitations:["Sitemap-led sample of same-origin URLs only; arbitrary internal links are not crawled.","Checks use server-delivered HTML and response headers. JavaScript rendering, Core Web Vitals, INP/LCP/CLS measurement and browser accessibility tests are not included.","A detected link is not proof that its destination is healthy; link destination status checks are not performed.","Scores are diagnostic heuristics, not search ranking or AI citation predictions."]};
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

      if(request.method==="POST"&&url.pathname==="/api/seo/site-audit"){
        if(!await allowAuditRequest(request,env,3,"seo-site"))return json({error:"SEO site audit rate limit reached. Maximum 3 site scans per hour per IP."},429,origin);
        const body=await request.json(),raw=String(body?.url||""),requested=Number(body?.max_pages||10);
        const maxPages=Math.min(30,Math.max(1,Number.isFinite(requested)?Math.floor(requested):10));
        const result=await auditSeoWholeSite(raw,maxPages);
        if(result.error)return json({error:result.error},400,origin);
        return json(result,200,origin);
      }
      if(request.method==="POST"&&url.pathname==="/api/seo/url-audit"){
        if(!await allowAuditRequest(request,env,5,"seo-url"))return json({error:"URL analysis rate limit reached. Maximum 5 scans per hour per IP."},429,origin);
        const body=await request.json();
        if(!body||typeof body.url!=="string"||body.url.length>2048)return json({error:"Provide a valid URL (maximum 2,048 characters)."},400,origin);
        const result=await auditSeoPublicUrl(body.url);
        if(result.error)return json({error:result.error},400,origin);
        return json(result,200,origin);
      }
      if ((request.method === "GET" && url.pathname === "/api/seo/audit") || (request.method === "POST" && url.pathname === "/api/ai-audit")) {
        if(!await allowAuditRequest(request,env,5,"audit"))return json({error:"Audit rate limit reached. Try again later (maximum 5 scans per hour per IP)."},429,origin);
        const raw=request.method==="GET"?(url.searchParams.get("url")||""):String((await request.json()).url||"");
        const result=await auditSiteUrl(raw);
        if(result.error)return json({error:result.error},400,origin);
        return json(result,200,origin);
      }
      if(request.method==="POST"&&url.pathname==="/api/ai-audit/site"){
        if(!await allowAuditRequest(request,env,5,"site"))return json({error:"Site audit rate limit reached. Maximum 5 site scans per hour per IP."},429,origin);
        const body=await request.json(),raw=String(body.url||""),requested=Number(body.max_pages||20);
        const maxPages=Math.min(30,Math.max(1,Number.isFinite(requested)?Math.floor(requested):20));
        const result=await auditWholeSite(raw,maxPages);
        if(result.error)return json({error:result.error},400,origin);
        return json(result,200,origin);
      }
      if(request.method==="POST"&&url.pathname==="/api/ai-audit/prepublish"){
        if(!await allowAuditRequest(request,env,20,"prepublish"))return json({error:"Pre-publish check rate limit reached. Maximum 20 checks per hour per IP."},429,origin);
        const body=await request.json();
        if(!String(body.title||"").trim()||String(body.content||"").trim().length<80)return json({error:"Enter a headline and at least 80 characters of article copy."},400,origin);
        const result=auditPrepublishDraft(body);
        return json(result,200,origin);
      }
      if (url.pathname === "/api/ai-audit/history" && request.method === "GET") {
        if(!env.DB || typeof env.DB.prepare !== "function")return json({history_available:false,history:[]},200,origin);
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_audit_history (id TEXT PRIMARY KEY, url TEXT NOT NULL, score INTEGER NOT NULL, report_json TEXT NOT NULL, audited_at TEXT NOT NULL)").run();
        const rows=await env.DB.prepare("SELECT id,url,score,audited_at FROM ai_audit_history WHERE url=? ORDER BY audited_at DESC LIMIT 20").bind(url.searchParams.get("url")||"").all();
        return json({history_available:true,history:rows.results||[]},200,origin);
      }
      if (url.pathname === "/api/ai-audit/history" && request.method === "POST") {
        if(!env.DB || typeof env.DB.prepare !== "function")return json({error:"Audit history requires the newsroom D1 database binding."},503,origin);
        const report=await request.json();
        if(!report||typeof report.url!=="string"||!Number.isInteger(report.score)||!Array.isArray(report.checks))return json({error:"Invalid audit report."},400,origin);
        const serialized=JSON.stringify(report);
        if(serialized.length>250000)return json({error:"Audit report exceeds the storage limit."},413,origin);
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_audit_history (id TEXT PRIMARY KEY, url TEXT NOT NULL, score INTEGER NOT NULL, report_json TEXT NOT NULL, audited_at TEXT NOT NULL)").run();
        const id=crypto.randomUUID(),auditedAt=report.audited_at||new Date().toISOString();
        await env.DB.prepare("INSERT INTO ai_audit_history (id,url,score,report_json,audited_at) VALUES (?,?,?,?,?)").bind(id,report.url,report.score,serialized,auditedAt).run();
        return json({saved:true,id,audited_at:auditedAt},201,origin);
      }
      if (request.method === "GET" && url.pathname === "/api/trends") {
        const windowName=url.searchParams.get("window")||"rising";
        if(!["rising","hot","trending"].includes(windowName))return json({error:"Window must be rising, hot or trending."},400,origin);
        const {trends,source,batch_error}=await fetchGoogleTrends(windowName);
        return json({window:windowName,region:"GB",category:"Sports",source,batch_error,trends,fetched_at:new Date().toISOString()},200,origin);
      }
      if (request.method === "GET" && url.pathname === "/api/feed") return json(await fetchStories(env,{fresh:url.searchParams.get("fresh")==="1"}),200,origin);
      if (request.method === "GET" && url.pathname === "/api/search") {
        const keyword=(url.searchParams.get("keyword")||"").trim();
        if(!keyword||keyword.length>100)return json({error:"Enter a search keyword (maximum 100 characters)."},400,origin);
        return json(await searchStories(env,keyword),200,origin);
      }
      if (request.method === "GET" && url.pathname === "/api/version") {
        return json({
          service: "thesportzine-newsroom",
          workerVersion: "newsroom-fixes-2026-11-15",
          headlineModel: "@cf/google/gemma-4-26b-a4b-it"
        }, 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        if (env.DB && typeof env.DB.prepare === "function") await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ ok: true, service: "thesportzine-newsroom", database: env.DB && typeof env.DB.prepare === "function" ? "connected" : "not_configured", feeds: "available", write_key: env.STUDIO_WRITE_KEY ? "required" : "not_configured" }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/discover-feed") {
        const body=await request.json();const homepage=String(body.url||"").trim();
        if(!validFeedUrl(homepage)||homepage.length>2048)return json({error:"Enter a valid public website URL."},400,origin);
        const denied=writeDenied(request,env,origin);if(denied)return denied;
        const base=new URL(homepage);const candidates=[homepage,base.origin+"/feed",base.origin+"/rss",base.origin+"/feed.xml",base.origin+"/rss.xml",base.origin+"/atom.xml",base.origin+"/index.xml"];const found=[];
        for(const candidate of candidates){if(!validFeedUrl(candidate))continue;try{const res=await fetch(candidate,{headers:{"Accept":"application/rss+xml, application/atom+xml, application/xml, text/xml, text/html","User-Agent":"TheSportzine-Newsroom/1.0"},signal:AbortSignal.timeout(6000)});if(!res.ok)continue;const bodyText=await res.text();if(/<(rss|feed|rdf:RDF)\b/i.test(bodyText)){found.push({url:candidate,title:base.hostname});break;}if(candidate===homepage){const tags=bodyText.match(/<link\b[^>]*>/gi)||[];for(const tagText of tags){if(!/alternate/i.test(tagText)||!/(rss|atom)\+xml/i.test(tagText))continue;const href=tagText.match(/href=["']([^"']+)["']/i);if(href){const feedHref=new URL(decodeHtml(href[1]),homepage).href;if(validFeedUrl(feedHref))found.push({url:feedHref,title:base.hostname});}}}}catch{}}
        return json({feeds:found},200,origin);
      }
      if (request.method === "POST" && url.pathname === "/api/ideas") {
        if(!await allowAuditRequest(request,env,30,"ideas"))return json({error:"Idea generation rate limit reached. Maximum 30 requests per hour per IP."},429,origin);
        if (!env.OPENAI_API_KEY) return json({error:"OpenAI is not configured on the Newsroom Worker. Add the OPENAI_API_KEY secret in Cloudflare."},503,origin);
        const body=await request.json();
        const account=String(body.account||"").toLowerCase();
        if(!["boxedninja","factodile"].includes(account))return json({error:"Account must be boxedninja or factodile."},400,origin);
        const boxed=account==="boxedninja";
        const instructions=boxed
          ? "You are the dedicated Instagram micro-copywriter for @boxedninja. The character is a cute black-clad ninja mascot with a bright pink headband. Write witty, relatable, short one-line jokes about everyday life: overthinking, procrastination, introversion, snacks, low battery, unread messages, sleep, motivation and small failures. Match the samples' tone: punchy, instantly understandable, playful and suitable as large text on a vertical social graphic. Vary the joke structures. No hashtags, emojis, image directions, numbering or explanations."
          : "You are the fact editor for @factodile, an Instagram account with a friendly crocodile mascot. Write surprising, genuinely accurate, accessible one-line facts across animals, nature, science, space, geography and history. Use well-established facts only; never invent statistics, records, dates or superlatives. Avoid myths and disputed claims. Each line should be specific, memorable and suitable as large text on a vertical social graphic. No hashtags, emojis, image directions, numbering or explanations.";
        const requestBody={
          model:"gpt-5.5",
          instructions,
          input:boxed
            ? "Create exactly 10 fresh, original one-line Instagram text ideas. Aim for 5–12 words each. Keep the set varied and avoid generic recycled meme phrases. Return only valid JSON in this exact shape: {\"ideas\":[\"...\", \"...\"]}."
            : "Create exactly 10 varied one-line factual posts. Aim for 8–18 words each. Return only valid JSON in this exact shape: {\"ideas\":[\"...\", \"...\"]}. Choose facts you are confident are established.",
          text:{format:{type:"json_object"}},
          max_output_tokens:900,
          temperature:0.85,
          store:false
        };
        let response;
        try{
          response=await fetch("https://api.openai.com/v1/responses",{
            method:"POST",
            headers:{"Authorization":"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},
            body:JSON.stringify(requestBody),
            signal:AbortSignal.timeout(26000)
          });
        }catch(error){
          const timedOut=error?.name==="TimeoutError"||error?.name==="AbortError";
          return json({error:timedOut?"OpenAI took longer than 26 seconds. Please try again.":"Could not connect to OpenAI. Please try again."},504,origin);
        }
        const rawBody=await response.text();
        let payload={};try{payload=JSON.parse(rawBody)}catch{}
        if(!response.ok){
          const detail=payload?.error?.message||("OpenAI API returned HTTP "+response.status);
          return json({error:detail.slice(0,260)},response.status===429?429:502,origin);
        }
        let output=typeof payload.output_text==="string"?payload.output_text:"";
        if(!output&&Array.isArray(payload.output)){
          output=payload.output.flatMap(item=>Array.isArray(item.content)?item.content.map(part=>part.text||""):[]).join("\n");
        }
        let parsed;try{parsed=JSON.parse(output)}catch{}
        let ideas=Array.isArray(parsed?.ideas)?parsed.ideas:[];
        ideas=ideas.map(x=>String(x).replace(/\s+/g," ").trim()).filter(x=>x&&x.length<=180).slice(0,10);
        if(ideas.length!==10)return json({error:"OpenAI responded, but did not return exactly 10 usable ideas. Please generate again."},502,origin);
        return json({account,ideas,generated_at:new Date().toISOString(),model:"gpt-5.5",note:boxed?null:"Verify each factual claim against a reliable source before publishing."},200,origin);
      }

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

      if (url.pathname === "/api/links") {
        const dbReady = env.DB && typeof env.DB.prepare === "function";
        if (request.method === "GET") {
          if (!dbReady) return json({ db_configured: false, links: [], short_base: LINK_BASE }, 200, origin);
          await ensureNewsroomSchema(env.DB);
          const rows = await env.DB.prepare("SELECT code, target, created_at, clicks, last_clicked_at, image_url, title FROM newsroom_links ORDER BY created_at DESC LIMIT ?").bind(LINK_LIST_LIMIT).all();
          return json({ db_configured: true, short_base: LINK_BASE, links: rows.results || [] }, 200, origin);
        }
        if (request.method === "POST" || request.method === "DELETE") {
          const denied = writeDenied(request, env, origin); if (denied) return denied;
          if (!dbReady) return json({ error: "Short links need the Cloudflare D1 binding (DB). Check the Newsroom deploy.", db_configured: false }, 503, origin);
          await ensureNewsroomSchema(env.DB);
          if (request.method === "DELETE") {
            const code = url.searchParams.get("code") || "";
            if (!LINK_CODE_PATTERN.test(code)) return json({ error: "A valid short code is required." }, 400, origin);
            await env.DB.prepare("DELETE FROM newsroom_links WHERE code = ?").bind(code).run();
            return json({ ok: true, code }, 200, origin);
          }
          const body = await request.json().catch(() => ({}));
          const target = cleanLinkTarget(body.url);
          if (!target) return json({ error: "Enter a full web address starting with https:// or http://." }, 400, origin);
          const previewImage = cleanPreviewImage(body.image_url);
          if (previewImage === undefined) return json({ error: "The preview image must be a web address starting with https:// or http://." }, 400, origin);
          const previewTitle = String(body.title || "").trim().slice(0, 200) || null;
          const requested = String(body.code || "").trim();
          if (requested && !LINK_CODE_PATTERN.test(requested)) return json({ error: "Custom codes use 3 to 40 letters, numbers, dashes or underscores." }, 400, origin);
          const now = new Date().toISOString();
          for (let attempt = 0; attempt < 4; attempt++) {
            const code = requested || randomLinkCode();
            const exists = await env.DB.prepare("SELECT code FROM newsroom_links WHERE code = ?").bind(code).first();
            if (exists) { if (requested) return json({ error: "That short code is already in use." }, 409, origin); continue; }
            await env.DB.prepare("INSERT INTO newsroom_links (code, target, created_at, clicks, image_url, title) VALUES (?, ?, ?, 0, ?, ?)").bind(code, target, now, previewImage, previewTitle).run();
            return json({ ok: true, code, target, short_url: LINK_BASE + "/" + code, created_at: now, image_url: previewImage, title: previewTitle }, 201, origin);
          }
          return json({ error: "Could not find a free short code. Try again." }, 503, origin);
        }
        return json({ error: "Method not allowed." }, 405, origin);
      }
      if (url.pathname === "/api/saved") {
        const dbReady = env.DB && typeof env.DB.prepare === "function";
        if (request.method === "GET") {
          if (!dbReady) return json({ db_configured: false, stories: [] }, 200, origin);
          await ensureNewsroomSchema(env.DB);
          const rows = await env.DB.prepare("SELECT story_json, saved_at FROM newsroom_saved_stories ORDER BY saved_at DESC LIMIT ?").bind(SAVED_STORY_LIMIT).all();
          const stories = (rows.results || []).map(row => { try { return { ...JSON.parse(row.story_json), saved_at: row.saved_at }; } catch { return null; } }).filter(Boolean);
          return json({ db_configured: true, stories }, 200, origin);
        }
        if (request.method === "POST" || request.method === "DELETE") {
          const denied = writeDenied(request, env, origin); if (denied) return denied;
          if (!dbReady) return json({ error: "Saved stories are kept in this browser only until the Cloudflare D1 binding (DB) is configured.", db_configured: false }, 503, origin);
          await ensureNewsroomSchema(env.DB);
          if (request.method === "DELETE") {
            const id = url.searchParams.get("id") || "";
            if (!id || id.length > 2048) return json({ error: "A saved story id is required." }, 400, origin);
            await env.DB.prepare("DELETE FROM newsroom_saved_stories WHERE id = ?").bind(id).run();
            return json({ ok: true, id }, 200, origin);
          }
          const body = await request.json();
          const list = Array.isArray(body.stories) ? body.stories : [body.story];
          const stories = list.slice(0, 200).map(cleanSavedStory).filter(Boolean);
          if (!stories.length) return json({ error: "Provide a story with an id, title and publisher link." }, 400, origin);
          const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM newsroom_saved_stories").first();
          if (Number(count?.n || 0) + stories.length > SAVED_STORY_LIMIT) return json({ error: "Saved stories are limited to " + SAVED_STORY_LIMIT + ". Remove some before saving more." }, 409, origin);
          const now = new Date().toISOString();
          await env.DB.batch(stories.map(story => env.DB.prepare("INSERT INTO newsroom_saved_stories (id, story_json, saved_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET story_json = excluded.story_json").bind(story.id, JSON.stringify(story), now)));
          return json({ ok: true, saved: stories.length, saved_at: now }, 201, origin);
        }
      }
      if ((url.pathname === "/api/sources" || url.pathname.startsWith("/api/sources/")) && ["POST","PATCH","DELETE"].includes(request.method)) {
        const denied = writeDenied(request, env, origin); if (denied) return denied;
        if (env.DB && typeof env.DB.prepare === "function") await ensureNewsroomSchema(env.DB);
      }
      if (request.method === "GET" && url.pathname === "/api/sources") {
        return json({ sources: await listSources(env.DB), db_configured: Boolean(env.DB && typeof env.DB.prepare === "function") }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/sources") {
        if (!env.DB || typeof env.DB.prepare !== "function") return json({ error: "Source management is unavailable because the Cloudflare D1 binding (DB) is not configured. Built-in sources are shown in read-only mode." }, 503, origin);
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
      if (match && ["PATCH","DELETE"].includes(request.method) && (!env.DB || typeof env.DB.prepare !== "function")) {
        return json({ error: "Source management is unavailable because the Cloudflare D1 binding (DB) is not configured. Built-in sources are shown in read-only mode." }, 503, origin);
      }
      if (match && request.method === "PATCH" && match[1].startsWith("builtin-")) {
        const index=Number(match[1].slice(8)),feed=DEFAULT_FEEDS[index];
        if(!feed)return json({error:"Source not found."},404,origin);
        const body=await request.json(),name=String(body.name??feed.name).trim(),feedUrl=String(body.feed_url??feed.url).trim(),sport=String(body.sport??feed.sport).trim();
        if(!name||name.length>100)return json({error:"Publication name is required (maximum 100 characters)."},400,origin);
        if(!validFeedUrl(feedUrl)||feedUrl.length>2048)return json({error:"Enter a valid public HTTP or HTTPS RSS/Atom URL."},400,origin);
        if(!sport||sport.length>60)return json({error:"A valid sport tag is required."},400,origin);
        await ensureNewsroomSchema(env.DB);
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
      if (error instanceof SyntaxError && /JSON/i.test(error.message)) return json({ error: "Request body must be valid JSON." }, 400, origin);
      return json({ error: error.message || "Newsroom API request failed." }, 500, origin);
    }
  }
};
