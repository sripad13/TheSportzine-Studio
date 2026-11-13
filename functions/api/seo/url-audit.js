const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 12000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Enter a valid public URL."); }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw new Error("Only public HTTP and HTTPS URLs are supported.");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") throw new Error("Private and local network addresses are not allowed.");
  // Disallow IP literals: the analyser accepts public hostnames only, preventing direct access to private/reserved IP ranges.
  if (/^[0-9.]+$/.test(host) || host.includes(":")) throw new Error("Enter a public website hostname rather than an IP address.");
  if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) throw new Error("Enter a valid public website hostname.");
  u.hash = "";
  return u;
}
function decodeEntities(s) {
  return s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n)))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16))));
}
function attr(tag, name) {
  const re = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const m = tag.match(re); return decodeEntities(m ? (m[1] ?? m[2] ?? m[3] ?? "") : "").trim();
}
function cleanText(html) {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<br\s*\/?>|<\/(?:p|div|section|article|li|h[1-6]|blockquote)\s*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function metaContent(html, key, attrName = "name") {
  const re = /<meta\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (attr(tag, attrName).toLowerCase() === key.toLowerCase()) return attr(tag, "content");
  }
  return "";
}
function score(checks) { return Math.round(checks.filter(x => x.ok).length / Math.max(1, checks.length) * 100); }
function item(ok, name, detail) { return { ok: !!ok, name, detail }; }

async function fetchPage(initial) {
  let current = initial;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    safeUrl(current.href);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current.href, {
        method: "GET", redirect: "manual", signal: controller.signal,
        headers: { "user-agent": "Newsroom-SEO-Analyzer/1.0 (+https://newsroom.falsewinger.com)", "accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" }
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The website returned a redirect without a destination.");
      if (i === MAX_REDIRECTS) throw new Error("The page exceeded the redirect limit.");
      current = safeUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error("The website returned HTTP " + response.status + ".");
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("The URL did not return an HTML page.");
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_BYTES) throw new Error("The page is larger than the 2 MB analysis limit.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The page returned an empty response.");
    const chunks = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); throw new Error("The page is larger than the 2 MB analysis limit."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
    return { html: new TextDecoder("utf-8").decode(bytes), url: current.href, status: response.status };
  }
  throw new Error("Could not follow the page redirects.");
}

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    if (!body || typeof body.url !== "string" || body.url.length > 2048) return json({ error: "Provide a valid URL (maximum 2,048 characters)." }, 400);
    const initial = safeUrl(body.url);
    const { html, url, status } = await fetchPage(initial);
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
    const title = titleMatch ? cleanText(titleMatch[1]) : "";
    const description = metaContent(html, "description");
    const canonicalTag = (html.match(/<link\b[^>]*>/gi) || []).find(t => attr(t, "rel").toLowerCase().split(/\s+/).includes("canonical"));
    const canonicalRaw = canonicalTag ? attr(canonicalTag, "href") : "";
    let canonical = "";
    try { canonical = canonicalRaw ? new URL(canonicalRaw, url).href : ""; } catch {}
    const robots = (metaContent(html, "robots") + " " + metaContent(html, "googlebot")).toLowerCase();
    const viewport = !!(html.match(/<meta\b[^>]*name\s*=\s*["']viewport["']/i));
    const headings = [];
    for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) headings.push({ level: Number(m[1]), text: cleanText(m[2]).slice(0, 240) });
    const h1Count = headings.filter(h => h.level === 1).length;
    const bodyTag = (html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i) || [null, html])[1];
    const content = cleanText(bodyTag);
    const words = content.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const text = content.toLowerCase();
    const paragraphs = [...bodyTag.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(m => cleanText(m[1])).filter(Boolean);
    const questions = (content.match(/[^.!?]{5,150}\?/g) || []).length;
    const faqSchema = /"@type"\s*:\s*"(?:FAQPage|QAPage)"/i.test(html);
    const schemaTypes = [];
    for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      try {
        const data = JSON.parse(m[1].replace(/^\s*<!--|-->\s*$/g, ""));
        const visit = v => { if (!v || typeof v !== "object") return; if (Array.isArray(v)) return v.forEach(visit); const t = v["@type"]; if (t) (Array.isArray(t) ? t : [t]).forEach(x => schemaTypes.push(String(x))); Object.values(v).forEach(visit); };
        visit(data);
      } catch {}
    }
    const uniqueSchemas = [...new Set(schemaTypes)];
    const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
    const links = [...html.matchAll(/<a\b[^>]*href\s*=/gi)].length;
    const hasNamedEntity = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}\b/.test(content);
    const hasAttribution = /\b(according to|said|told|reported by|confirmed by|announced by|data from|source:|via )\b/i.test(content);
    const hasEvidence = /\b\d+(?:[.,]\d+)?\s*(?:%|percent|million|billion|thousand|years?|days?)?\b/i.test(content);
    const hasTime = /\b(?:20\d{2}|yesterday|today|on monday|on tuesday|on wednesday|on thursday|on friday|on saturday|on sunday)\b/i.test(content);
    const hasContext = /\b(after|before|since|because|following|while|during|compared with|in the context of)\b/i.test(content);
    const hasFaq = faqSchema || /frequently asked questions|\bfaqs?\b/i.test(content);
    const answerParagraph = paragraphs.some(p => p.split(/\s+/).length >= 20 && p.split(/\s+/).length <= 90);
    const answerLanguage = /\b(in short|the answer is|yes,|no,|confirmed|means that|here is why)\b/i.test(content);
    const seo = [
      item(title.length >= 30 && title.length <= 60, "Title tag", title ? title.length + " characters; aim for around 30–60." : "No title tag found."),
      item(!!description && description.length >= 120 && description.length <= 160, "Meta description", description ? description.length + " characters; aim for around 120–160." : "No meta description found."),
      item(h1Count === 1, "Single H1 heading", h1Count + " H1 headings found; use one clear page-level heading."),
      item(headings.length >= 2, "Heading hierarchy", headings.length + " headings detected."),
      item(!!canonical, "Canonical URL", canonical ? "Canonical URL is declared." : "No canonical link found."),
      item(!/noindex/.test(robots), "Indexability directive", /noindex/.test(robots) ? "A noindex directive was detected." : "No noindex directive detected in meta robots."),
      item(viewport, "Mobile viewport", viewport ? "Viewport metadata is present." : "Add a responsive viewport meta tag."),
      item(imageTags.length === 0 || imageTags.every(t => !!attr(t, "alt")), "Image alt attributes", imageTags.filter(t => !attr(t, "alt")).length + " of " + imageTags.length + " images have missing alt text."),
      item(links > 0, "Links", links + " links detected in the HTML."),
      item(wordCount >= 300, "Main content depth", wordCount + " visible words extracted; context matters more than a fixed length.")
    ];
    const aeo = [
      item(wordCount >= 120, "Answer context", wordCount + " visible words extracted."),
      item(headings.length >= 2, "Question-friendly structure", headings.length + " headings detected."),
      item(questions > 0 || hasFaq, "Questions and FAQs", questions + " question marks detected; FAQ schema/content " + (hasFaq ? "found." : "not found.")),
      item(answerLanguage || answerParagraph, "Direct answer format", answerLanguage ? "Answer-led language detected." : "Look for concise, self-contained answer paragraphs."),
      item(answerParagraph, "Extractable answer paragraphs", "Paragraphs of 20–90 words " + (answerParagraph ? "were found." : "were not detected.")),
      item(headings.some(h => h.level === 2 || h.level === 3), "Semantic subheadings", "H2/H3 sections " + (headings.some(h => h.level === 2 || h.level === 3) ? "are present." : "are missing.")),
      item(uniqueSchemas.some(x => ["Article", "NewsArticle", "BlogPosting", "FAQPage", "QAPage", "HowTo"].includes(x)), "Relevant structured data", uniqueSchemas.length ? uniqueSchemas.join(", ") : "No JSON-LD schema types detected.")
    ];
    const geo = [
      item(hasNamedEntity, "Named entities", hasNamedEntity ? "Potential named entities detected in page text." : "Use explicit names for people, organisations, products and places."),
      item(hasAttribution, "Source attribution", hasAttribution ? "Attribution language detected." : "Attribute reporting, quotes and claims to identifiable sources."),
      item(hasEvidence, "Evidence and specifics", hasEvidence ? "Numbers or measurable details detected." : "Add verifiable figures and concrete details where relevant."),
      item(hasTime, "Temporal context", hasTime ? "Date or time references detected." : "Make publication/event timing explicit."),
      item(headings.length >= 2, "Information hierarchy", headings.length + " headings detected."),
      item(hasContext, "Context and relationships", hasContext ? "Explanatory or relational language detected." : "Explain why the event happened and how it connects to the wider topic."),
      item(wordCount >= 300, "Topical depth", wordCount + " visible words extracted."),
      item(uniqueSchemas.length > 0, "Machine-readable entities", uniqueSchemas.length ? "Schema types: " + uniqueSchemas.join(", ") : "No JSON-LD structured data detected."),
      item(!!meta && !!title, "Clear page framing", "Title and description " + (title && description ? "are both present." : "are incomplete."))
    ];
    return json({
      url, status, auditedAt: new Date().toISOString(), title, metaDescription: description, canonical,
      wordCount, headingCount: headings.length, headings, schemaTypes: uniqueSchemas,
      scores: { seo: score(seo), aeo: score(aeo), geo: score(geo) },
      checks: { seo, aeo, geo }
    });
  } catch (error) {
    const message = error?.name === "AbortError" ? "The website took too long to respond. Try again." : (error?.message || "Unable to analyse this URL.");
    return json({ error: message }, 400);
  }
}
