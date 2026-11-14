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
const AUDIT_RATE_LIMITS=new Map();
async function allowAuditRequest(request,env,limit=5){
 const ip=request.headers.get("CF-Connecting-IP")||"unknown",now=Date.now(),windowMs=60*60*1000;
 if(env.DB){
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
 if(!options.skipSiteFiles)add("files","AI and search discovery files",robotsAvailable&&sitemapResponse?.ok===true,"robots.txt: "+(robotsAvailable?"available":"not found")+". sitemap.xml: "+(sitemapResponse?.ok?"available":"not found")+". llms.txt: "+(llmsResponse?.ok?"available":"not found")+".",{robots_available:robotsAvailable,sitemap_available:!!sitemapResponse?.ok,llms_available:!!llmsResponse?.ok,llms_excerpt:llmsText.slice(0,1200),sitemap_excerpt:sitemapText.slice(0,500)});
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
  // Keep the Sources page useful when the Cloudflare D1 binding is absent.
  // Built-in feeds are available without persistence; custom source management
  // remains disabled until the DB binding is configured.
  if (!db) return DEFAULT_FEEDS.map((feed,index)=>({
    id:"builtin-"+index,name:feed.name,feed_url:feed.url,sport:feed.sport,
    priority:1,enabled:true,is_default:true
  }));
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

async function auditSeoPublicUrl(raw) {
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
      {ok:wordCount>=300,name:"Main content depth",detail:wordCount+" visible words extracted; context matters more than a fixed length."}
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
    ]
  };
  const score=items=>Math.round(items.filter(x=>x.ok).length/Math.max(1,items.length)*100);
  return {url:target.href,status:response.status,auditedAt:new Date().toISOString(),title,metaDescription:description,canonical,wordCount,headingCount:headings.length,headings,schemaTypes:uniqueSchemas,scores:{seo:score(checks.seo),aeo:score(checks.aeo),geo:score(checks.geo)},checks};
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

      if(request.method==="POST"&&url.pathname==="/api/seo/url-audit"){
        if(!await allowAuditRequest(request,env,5))return json({error:"URL analysis rate limit reached. Maximum 5 scans per hour per IP."},429,origin);
        const body=await request.json();
        if(!body||typeof body.url!=="string"||body.url.length>2048)return json({error:"Provide a valid URL (maximum 2,048 characters)."},400,origin);
        const result=await auditSeoPublicUrl(body.url);
        if(result.error)return json({error:result.error},400,origin);
        return json(result,200,origin);
      }
      if ((request.method === "GET" && url.pathname === "/api/seo/audit") || (request.method === "POST" && url.pathname === "/api/ai-audit")) {
        if(!await allowAuditRequest(request,env))return json({error:"Audit rate limit reached. Try again later (maximum 5 scans per hour per IP)."},429,origin);
        const raw=request.method==="GET"?(url.searchParams.get("url")||""):String((await request.json()).url||"");
        const result=await auditSiteUrl(raw);
        if(result.error)return json({error:result.error},400,origin);
        return json(result,200,origin);
      }
      if(request.method==="POST"&&url.pathname==="/api/ai-audit/site"){
        if(!await allowAuditRequest(request,env,5))return json({error:"Site audit rate limit reached. Maximum 5 site scans per hour per IP."},429,origin);
        const body=await request.json(),raw=String(body.url||""),requested=Number(body.max_pages||20);
        const maxPages=Math.min(30,Math.max(1,Number.isFinite(requested)?Math.floor(requested):20));
        const result=await auditWholeSite(raw,maxPages);
        if(result.error)return json({error:result.error},400,origin);
        return json(result,200,origin);
      }
      if(request.method==="POST"&&url.pathname==="/api/ai-audit/prepublish"){
        if(!await allowAuditRequest(request,env,20))return json({error:"Pre-publish check rate limit reached. Maximum 20 checks per hour per IP."},429,origin);
        const body=await request.json();
        if(!String(body.title||"").trim()||String(body.content||"").trim().length<80)return json({error:"Enter a headline and at least 80 characters of article copy."},400,origin);
        const result=auditPrepublishDraft(body);
        return json(result,200,origin);
      }
      if (url.pathname === "/api/ai-audit/history" && request.method === "GET") {
        if(!env.DB)return json({history_available:false,history:[]},200,origin);
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_audit_history (id TEXT PRIMARY KEY, url TEXT NOT NULL, score INTEGER NOT NULL, report_json TEXT NOT NULL, audited_at TEXT NOT NULL)").run();
        const rows=await env.DB.prepare("SELECT id,url,score,audited_at FROM ai_audit_history WHERE url=? ORDER BY audited_at DESC LIMIT 20").bind(url.searchParams.get("url")||"").all();
        return json({history_available:true,history:rows.results||[]},200,origin);
      }
      if (url.pathname === "/api/ai-audit/history" && request.method === "POST") {
        if(!env.DB)return json({error:"Audit history requires the newsroom D1 database binding."},503,origin);
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
      if (request.method === "POST" && url.pathname === "/api/ideas") {
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

      if (request.method === "GET" && url.pathname === "/api/sources") {
        return json({ sources: await listSources(env.DB), db_configured: Boolean(env.DB) }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/sources") {
        if (!env.DB) return json({ error: "Source management is unavailable because the Cloudflare D1 binding (DB) is not configured. Built-in sources are shown in read-only mode." }, 503, origin);
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
      if (match && ["PATCH","DELETE"].includes(request.method) && !env.DB) {
        return json({ error: "Source management is unavailable because the Cloudflare D1 binding (DB) is not configured. Built-in sources are shown in read-only mode." }, 503, origin);
      }
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
