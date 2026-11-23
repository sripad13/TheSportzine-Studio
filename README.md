# Studio — Sports content workspace

Studio brings Newsroom, Create, Optimize and Audit workflows together. The original **Graphics editor** remains available at `/graphics.html`.

## Newsroom interface
The root page is the Studio landing page. The live editorial workspace remains available at `/newsroom/` with independently scrolling, resizable columns; All Sports, Football, Formula 1 and Breaking workspaces (buttons on desktop, a menu on mobile); keyword columns (comma-separated keywords match any); Newest/Priority sorting per column; saved stories synced through D1; and a right-side story inspection drawer.

## RSS aggregation API
The Worker exposes:
- `GET /api/health` — service health and D1 status.
- `GET /api/feed` — fetches the configured RSS/Atom feeds, extracts headlines/excerpts and source links, and groups stories that share a URL or a near-identical headline. Feed responses are cached in the Worker for 3 minutes; `?fresh=1` (the Refresh button) reuses only results younger than 30 seconds.
- `GET /api/search?keyword=...` — searches headlines and excerpts across the configured feeds. Separate several keywords with commas to match any of them (used by Priority Desk).
- `GET/POST/DELETE /api/saved` — saved stories, stored in D1 with a copy of each story so they stay available after the RSS feed drops them. Without D1, saved stories stay in the browser.
- `POST /api/ideas` — generates social post ideas via OpenAI; limited to 30 requests per IP per hour.

Configured feeds: BBC Sport Football, Sky Sports Football, BBC Sport Formula 1, Sky Sports Formula 1, Autosport F1, Motorsport.com F1 and Formula1.com. Feed availability and formats can change; individual failures are returned in the `feeds` array while other sources continue to load. The initial editorial priority/breaking flags are keyword heuristics, not AI analysis or fact-checking.

### Deploy
Pushing changes to `newsroom-worker.js`, `wrangler.toml` or `newsroom-schema.sql` on `main` runs `.github/workflows/deploy-newsroom-worker.yml`, which:
1. Finds the D1 database `thesportzine-newsroom` (or any database with "newsroom" in its name), creating it if none exists, and adds it as the `DB` binding. `wrangler deploy` replaces dashboard-added bindings, so the binding must come from the deploy itself.
2. Applies `newsroom-schema.sql` (idempotent).
3. Deploys the Worker. If the API token lacks D1 permission, it deploys without a database and logs a warning; sources are then read-only.

Check `https://newsroom-api.falsewinger.com/api/health`: `database` should be `connected`.

### Write protection
Adding, editing or deleting sources and saving stories are write actions. By default the Worker only accepts them from the Studio origins. For real protection, set a secret and enter the same value once per browser under Newsroom → Settings → **Studio write key**:

```
npx wrangler secret put STUDIO_WRITE_KEY --config wrangler.toml
```

`/api/health` reports `write_key: required` once the secret is active. Cloudflare Access can be added on top if you want sign-in protection.

The API Worker's CORS allowlist includes `https://newsroom.falsewinger.com` and the GitHub Pages origin. Cloudflare Access should be used to protect the app/API if desired; CORS is not authentication.

## RSS terms and editorial use
Formula1.com is included as requested. Personal use does not by itself establish permission under a publisher's feed terms, so confirm the current terms and keep use within the permitted scope. Feed access is not permission to republish full articles or images. The interface displays headlines and short feed excerpts with links to the publisher. Review each publisher's terms before any wider distribution.

## SEO Studio extended audits

SEO Studio at `/optimize/` now includes expanded public-URL and sitemap-led site audits. The lightweight Worker checks cover:
- On-page SEO: titles, descriptions, H1 and heading hierarchy, canonical and indexability signals, mobile viewport, content depth, Open Graph and X/Twitter cards.
- Technical SEO: robots.txt, WordPress sitemap variants (`sitemap.xml`, `sitemap_index.xml`, `wp-sitemap.xml`), canonical consistency, character encoding, redirects and HSTS.
- Structured data: JSON-LD syntax, Article/NewsArticle properties, author, publisher, publication/update dates and mainEntityOfPage.
- Content quality: visible content volume, paragraph structure, heading hierarchy and basic template/noise checks.
- Image SEO: alt attributes, dimensions, lazy-loading signals and image-format hints.
- Links: internal/external link counts, empty anchor names and missing href attributes.
- E-E-A-T / publisher transparency: author, publisher, publication/update dates and About/Contact/editorial-policy links.
- AI discovery: robots.txt, sitemap and optional llms.txt availability/content, alongside the existing AEO/GEO editorial heuristics.

The Article Optimiser keeps one SEO score plus separate AEO and GEO scores. URL analysis displays the extended technical categories and a prioritised fix queue. Site Audit uses a sitemap-led same-origin sample (up to 30 pages) and aggregates recurring findings with affected page URLs.

API endpoints:
- `POST /api/seo/url-audit` with `{"url":"https://example.com/article/"}` — extended single-page checks.
- `POST /api/seo/site-audit` with `{"url":"https://example.com/","max_pages":10}` — sitemap-led multi-page audit, maximum 30 pages; rate limited to three runs per IP per hour when D1 rate limiting is available.
- `GET /api/seo/site-audit/history?url=https://example.com/` — the latest 10 saved site-audit runs for a hostname. Each new site audit stores its report in D1 and returns the previous score for comparison.

Limitations: this is a focused native implementation inspired by SEOmator's audit categories, not a port of its complete 398-rule engine. Checks inspect server-delivered HTML and do not execute JavaScript. Link presence/anchor quality is measured, but destination availability is not tested. Core Web Vitals, browser rendering, accessibility tree checks, mobile parity and render-time asset diagnostics are deliberately deferred. Scores are diagnostic heuristics, not search ranking or AI citation predictions.

## AI Crawler Audit
Studio includes an AI Search Visibility Audit at `/audit/` (legacy `/ai-visibility.html` redirects). It accepts any public HTTP/HTTPS website and runs 35 weighted checks across eight categories, including 17 representative AI/search crawler User-Agent probes, readable HTML, JSON-LD, discovery files, Answer Engine Optimisation (AEO) and Generative Engine Optimisation (GEO) signals. AEO checks cover question-led headings, concise answer blocks, FAQ structure, definitions and optional speakable hints. GEO checks cover author/publisher identity, publication dates, source citations, publisher transparency and entity context. These are page-level heuristics, not guarantees of AI citations or rankings.

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

- `/audit/site/` — sitemap-based site audit. Discovers same-origin URLs from up to five sitemap files (including sitemap indexes), respects matching robots.txt rules when selecting pages, and audits up to 30 pages per run. The root page receives the 17 crawler probes and discovery-file checks; other pages receive content, metadata, structured-data, AEO and GEO checks. Results include aggregate category scores, page-level scores, skipped URLs and JSON export. This is a bounded sitemap sample, not an unrestricted website crawler.
- `/audit/prepublish/` — article draft checker. Accepts pasted plain text, Markdown or HTML plus headline, byline, publisher, canonical URL, publication date, source URLs and key entities. It checks headline length, opening clarity, headings, paragraph length, FAQ/question structure, entity coverage, author/publisher identity and source/date signals. It returns a suggested `NewsArticle` JSON-LD object and downloadable report. The draft is processed for the request and is not persisted by this endpoint; the checker does not verify facts or whether citations support individual claims.

Additional API endpoints:
- `POST /api/ai-audit/site` with `{"url":"https://example.com","max_pages":20}`. Maximum 30 pages; five site scans per IP per hour when D1 rate limiting is configured.
- `POST /api/ai-audit/prepublish` with JSON fields `title`, `content`, `author`, `publisher`, `url`, `published_at`, `source_urls` and `entities`. Rate limit: 20 checks per IP per hour when D1 rate limiting is configured.

All scores are heuristic diagnostics. They do not represent measured AI citations, ranking, provider indexing or fact verification.


## Advanced SEO tools in Optimize

The Optimize page includes publisher-oriented workflows inspired by the MIT-licensed [Claude SEO](https://github.com/AgriciDaniel/claude-seo) project. Studio keeps its own Cloudflare Pages + Worker architecture rather than importing the project's Claude Code runtime.

- **Content Brief:** creates article-format-specific outlines with reader intent, information gain, sourcing, E-E-A-T and internal-link requirements. It does not invent live SERP competitor data or search volumes.
- **E-E-A-T Review:** editorial presence checklist for first-hand reporting, author expertise, corroborating sources and publisher transparency. This is not a Google ranking score or verified reputation score.
- **Schema Lab:** generates JSON-LD for common article and publisher entities, and inspects JSON-LD blocks on a fetched public page. Property-level conformance and rich-result eligibility still require Schema.org Validator and Google's Rich Results Test.
- **AI Agent Readiness:** checks robots.txt, llms.txt, explicit AI crawler groups and optional AI catalog discovery files. It does not test WAF behaviour, accessibility trees or official Lighthouse Agentic Browsing results.
- **International SEO:** inspects HTML hreflang tags for basic language/region format, duplicates, HTTPS, self-reference and x-default. Reciprocal return tags and alternate-page indexability are not verified yet.

The Worker exposes `POST /api/seo/public-resource` to retrieve bounded public text/HTML/JSON/XML resources for these tools. It uses the same public-target validation and redirect protections as other SEO fetches, has an independent rate limit, and does not accept arbitrary methods or private network destinations. This endpoint returns resource bodies to the Studio UI; do not use it to fetch authenticated/private content.

**Attribution and licence:** Claude SEO is MIT licensed. This integration uses adapted workflow concepts and limited implementation patterns, not its bundled local runtime. The MIT copyright and permission notice are retained in this documentation. Copyright (c) 2026 agricidaniel; original content and repository: https://github.com/AgriciDaniel/claude-seo.

## Studio brand system

- Product name: **Studio**.
- Official brand assets are in `/brand/`.
- Shared navigation and theme styles are in `/assets/studio/`.
- The header is shared across the landing page and application pages. Navigation order: Newsroom, Create, Optimize, Audit.
- Theme choices: System, Light and Dark. The selection persists in the browser.
- Brand palette: lime `#B7D957`, near-black `#0B0B0D`, white `#FFFFFF`, warm light canvas `#F5F6F2`.
- The redesign does not change the current hostname, API hostname, route paths, Workers or D1 configuration. URL migration is a separate future phase.

## Analyze — Diib-inspired SEO intelligence

Analyze is the site-wide SEO intelligence workspace at `/analyze/`; Optimize remains focused on individual article improvements. The workspace includes:
- DataForSEO keyword ideas and live Google SERP checks by global or country market.
- Domain ranking distribution and competitor-domain discovery.
- Ranked-keyword discovery with a RankGuard-style opportunity view for keywords in positions 4–20.
- Manual ranking snapshots stored in D1, with position-change alerts compared with the previous refresh.
- Backlink profile summaries, including backlinks, referring domains/pages, broken-link indicators and link spam score where supplied.
- Links to the existing technical SEO and AI visibility audits.

The Worker exposes `POST /api/analyze/keywords`, `/api/analyze/domain`, `/api/analyze/serp`, `/api/analyze/rankings`, `/api/analyze/competitors` and `/api/analyze/backlinks`. Configure `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` as Cloudflare Worker secrets; never place provider credentials in frontend code. Requests share a 12-per-IP-per-hour allowance and successful responses are cached in Worker memory for 10 minutes where the isolate remains warm. Provider-reported costs are shown in the interface.

Rank snapshots are recorded only when a user manually refreshes rankings; no scheduled daily scans run. Ranking, traffic, difficulty and backlink values are third-party estimates, not first-party Search Console data. Search Console OAuth, automated rank scheduling and measured AI citations remain separate workstreams. API usage is billable by DataForSEO; review endpoint pricing before repeated use.
