# Newsroom feed research and launch checklist

Research date: 10 November 2026

## Recommended initial RSS registry

| Publisher / section | Feed URL | Coverage | Launch status |
|---|---|---|---|
| BBC Sport Football | https://feeds.bbci.co.uk/sport/football/rss.xml | Football | Candidate; check BBC feed terms before commercial use |
| Sky Sports Football | https://www.skysports.com/rss/11095 | Football | Candidate; validate endpoint and terms |
| The Guardian Football | https://www.theguardian.com/football/rss | Football | Do not enable for commercial use without permission |
| BBC Sport Formula 1 | https://feeds.bbci.co.uk/sport/formula1/rss.xml | F1 | Candidate; check BBC feed terms before commercial use |
| Sky Sports Formula 1 | https://www.skysports.com/rss/12433 | F1 | Candidate; validate endpoint and terms |
| Autosport Formula 1 | https://www.autosport.com/rss/feed/f1 | F1 | Candidate; Autosport's RSS directory advertises free RSS; review terms |
| Motorsport.com F1 | https://www.motorsport.com/rss/f1/news/ | F1 | Candidate; validate endpoint and terms |
| Formula1.com | https://www.formula1.com/content/fom-website/en/latest/all.xml | F1 | Disabled: F1 RSS terms prohibit commercial aggregation and republication |
| The Athletic | https://www.nytimes.com/athletic/rss/news/ | Multi-sport | Optional; broad feed requires sport filtering and subscription/source checks |
| ESPN Soccer | https://www.espn.com/espn/rss/soccer/news | Football | Optional; availability is unreliable and must be monitored |

RSS availability is not a licence to republish. Keep the product as an authenticated internal editorial tool, show headlines/excerpts only, link every item directly to its publisher, and do not copy full article text or publisher images. Get publisher permission where terms require it before commercial aggregation or external redistribution.

## Technical architecture

- Static frontend: GitHub Pages, same repository; Newsroom root and existing graphics editor at /graphics.html.
- Feed and source API: Cloudflare Worker at https://newsroom-api.falsewinger.com.
- Persistence: Cloudflare D1; schema is in newsroom-schema.sql.
- AI editorial assistance: Cloudflare Workers AI binding (AI). The model must be selected from the currently supported model catalogue at deployment time; do not hard-code a deprecated model.
- Authentication: Cloudflare Access on both the newsroom hostname and API hostname. CORS origin checks are not authentication.
- Ingestion: fetch RSS/Atom on the Worker, normalize titles, excerpts, dates, publisher links; deduplicate on canonical URL; keep source attribution.
- Editorial workflow: Article / Social / Breaking / Saved queues; decisions and notes persisted per story; no auto-publishing.
- Reliability: per-source last-success timestamp, error status, retry/backoff, cache, timeouts and a manual refresh action.

## Required D1 schema alignment

The existing Worker source manager expects newsroom_sources columns:
id, name, feed_url, sport, priority, enabled, created_at, updated_at, last_fetched_at.
The supplied newsroom-schema.sql creates that table. Apply it to a newly created D1 database before deploying the Worker.

## Domain migration checklist

1. Verify newsroom.falsewinger.com in GitHub Pages repository settings before changing DNS.
2. Configure the repository's CNAME file to newsroom.falsewinger.com (done on feature/newsroom-phase-1).
3. In DNS, create CNAME newsroom -> sripad13.github.io. GitHub recommends adding the custom domain in Pages before DNS and notes DNS propagation can take up to 24 hours.
4. Enable Enforce HTTPS once GitHub Pages has provisioned the certificate.
5. Keep the old tsc.falsewinger.com DNS record until the new hostname has been verified; then remove it or redirect it as desired.
6. Update the Buffer Worker CORS allowlist to the new origin (done on feature/newsroom-phase-1).

## Deployment blockers / external actions

- GitHub Pages custom-domain setting must be changed in repository Settings -> Pages; the CNAME file alone does not complete the migration.
- DNS must be updated by the domain operator.
- Create the D1 database, copy its database_id into wrangler.toml under [[d1_databases]], and apply newsroom-schema.sql.
- Attach newsroom-api.falsewinger.com to the Worker and enable Cloudflare Access.
- Add Workers AI binding and choose a currently supported model. Cloudflare Workers AI requires an AI binding; usage is billed/subject to account limits.
- Test every RSS endpoint from the deployed Worker, since publishers can block, change or rate-limit feeds.

## Phase 1 acceptance criteria

- New domain serves the Newsroom homepage over HTTPS.
- Existing graphics editor remains accessible at /graphics.html.
- Source manager can add, edit, pause and remove feeds through D1.
- At least one football feed and one F1 feed return live items.
- Duplicate URLs are collapsed; failed sources show their error state.
- Saved stories and editorial decisions persist across reloads (D1, not only localStorage).
- AI analysis is clearly labelled as assistance, includes source links and verification prompts, and never claims to fact-check independently.
- No story is auto-published.
