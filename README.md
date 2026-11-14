# Studio — Sports content workspace

Studio brings Newsroom, Create, Optimize and Audit workflows together. The original **Graphics editor** remains available at `/graphics.html`.

## Newsroom interface
The root page is the Studio landing page. The live editorial workspace remains available at `/live/` with independently scrolling, resizable columns; All Sports, Football, Formula 1 and Breaking workspaces; keyword columns; saved stories; and a right-side story inspection drawer.

## RSS aggregation API
The Worker exposes:
- `GET /api/health` — service health and D1 status.
- `GET /api/feed` — fetches the configured football and F1 RSS/Atom feeds, extracts headlines/excerpts and source links, and groups exact/near-exact headline matches.
- `GET /api/search?keyword=...` — searches headlines and excerpts across the configured feeds (used by Newsroom keyword columns).
- `POST /api/ideas` — generates social post ideas via OpenAI; limited to 30 requests per IP per hour.

Configured feeds: BBC Sport Football, Sky Sports Football, BBC Sport Formula 1, Sky Sports Formula 1, Autosport F1, Motorsport.com F1 and Formula1.com. Feed availability and formats can change; individual failures are returned in the `feeds` array while other sources continue to load. The initial editorial priority/breaking flags are keyword heuristics, not AI analysis or fact-checking.

### Deploy
1. Deploy `newsroom-worker.js` as the Cloudflare Worker `thesportzine-newsroom-api`.
2. Attach the custom domain `newsroom-api.falsewinger.com`.
3. In the Studio header, enter `https://newsroom-api.falsewinger.com` and select **Connect**.
4. Test `https://newsroom-api.falsewinger.com/api/health` and `/api/feed`.
5. D1 is only required for the existing source-management endpoints. Add the binding and apply `newsroom-schema.sql` if you want to use those endpoints; RSS aggregation itself does not require D1.

The API Worker's CORS allowlist includes `https://newsroom.falsewinger.com` and the GitHub Pages origin. Cloudflare Access should be used to protect the app/API if desired; CORS is not authentication.

## RSS terms and editorial use
Formula1.com is included as requested. Personal use does not by itself establish permission under a publisher's feed terms, so confirm the current terms and keep use within the permitted scope. Feed access is not permission to republish full articles or images. The interface displays headlines and short feed excerpts with links to the publisher. Review each publisher's terms before any wider distribution.

## AI Crawler Audit
Studio includes an AI Search Visibility Audit at `/ai-audit/` (legacy `/ai-visibility.html` redirects). It accepts any public HTTP/HTTPS website and runs 35 weighted checks across eight categories, including 17 representative AI/search crawler User-Agent probes, readable HTML, JSON-LD, discovery files, Answer Engine Optimisation (AEO) and Generative Engine Optimisation (GEO) signals. AEO checks cover question-led headings, concise answer blocks, FAQ structure, definitions and optional speakable hints. GEO checks cover author/publisher identity, publication dates, source citations, publisher transparency and entity context. These are page-level heuristics, not guarantees of AI citations or rankings.

The Worker exposes:
- `POST /api/ai-audit` with JSON body `{"url":"https://example.com"}`.
- `GET /api/seo/audit?url=...` as a backwards-compatible route.
- `GET /api/ai-audit/history?url=...` and `POST /api/ai-audit/history` for D1-backed scan history.

Audit history and hashed-IP rate limits are stored in D1 when the existing `DB` binding is configured; the Worker creates their tables on first use. Without D1, the interface keeps recent history in the current browser and the Worker applies a best-effort per-isolate rate limit. Audits are limited to five requests per IP per hour when D1 is available. Each tool (single-page audit, site audit, SEO URL check, pre-publish check) has its own separate limit. Private/local hostnames, IP-literal destinations, non-standard ports and redirects are rejected to reduce SSRF risk.

Crawler checks use representative User-Agent headers and respect matching `robots.txt` disallow rules (a blocked probe is skipped). Results do not prove provider indexing, citation, ranking or future crawl behaviour. The scanner inspects server-delivered HTML and does not execute JavaScript. CORS is not authentication; protect the API Worker with Cloudflare Access and configure Cloudflare edge rate limiting for production.

## Graphics module
The original graphics editor remains preserved at `graphics.html`. Its Buffer integration continues to use `buffer-worker.js`; the Studio frontend hostname has been added to that Worker's CORS allowlist.


## Expanded AI Search Visibility tools

The AI Audit suite now includes two additional workflows:

- `/ai-audit/site/` — sitemap-based site audit. Discovers same-origin URLs from up to five sitemap files (including sitemap indexes), respects matching robots.txt rules when selecting pages, and audits up to 30 pages per run. The root page receives the 17 crawler probes and discovery-file checks; other pages receive content, metadata, structured-data, AEO and GEO checks. Results include aggregate category scores, page-level scores, skipped URLs and JSON export. This is a bounded sitemap sample, not an unrestricted website crawler.
- `/ai-audit/prepublish/` — article draft checker. Accepts pasted plain text, Markdown or HTML plus headline, byline, publisher, canonical URL, publication date, source URLs and key entities. It checks headline length, opening clarity, headings, paragraph length, FAQ/question structure, entity coverage, author/publisher identity and source/date signals. It returns a suggested `NewsArticle` JSON-LD object and downloadable report. The draft is processed for the request and is not persisted by this endpoint; the checker does not verify facts or whether citations support individual claims.

Additional API endpoints:
- `POST /api/ai-audit/site` with `{"url":"https://example.com","max_pages":20}`. Maximum 30 pages; five site scans per IP per hour when D1 rate limiting is configured.
- `POST /api/ai-audit/prepublish` with JSON fields `title`, `content`, `author`, `publisher`, `url`, `published_at`, `source_urls` and `entities`. Rate limit: 20 checks per IP per hour when D1 rate limiting is configured.

All scores are heuristic diagnostics. They do not represent measured AI citations, ranking, provider indexing or fact verification.


## Studio brand system

- Product name: **Studio**.
- Official brand assets are in `/brand/`.
- Shared navigation and theme styles are in `/assets/studio/`.
- The header is shared across the landing page and application pages. Navigation order: Newsroom, Create, Optimize, Audit.
- Theme choices: System, Light and Dark. The selection persists in the browser.
- Brand palette: lime `#B7D957`, near-black `#0B0B0D`, white `#FFFFFF`, warm light canvas `#F5F6F2`.
- The redesign does not change the current hostname, API hostname, route paths, Workers or D1 configuration. URL migration is a separate future phase.
