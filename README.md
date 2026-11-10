# TheSportzine Studio — Newsroom

The Studio now has two modules: **Newsroom** (root) and **Graphics** (/graphics.html).

## Domain
GitHub Pages custom domain: `newsroom.falsewinger.com`. The repository CNAME file must match. Add/verify the custom domain in GitHub Pages and point the DNS CNAME at the GitHub Pages host. Do not remove the existing DNS record until the new domain is verified and serving correctly.

## Newsroom Phase 1
- Editorial feed UI for Football and Formula 1.
- Article Desk, Social Desk, Breaking queue and Saved stories.
- Rules-based editorial triage; this is not AI fact-checking.
- RSS API in `newsroom-worker.js`; deployment config in `wrangler.toml`.
- Optional persistence schema in `newsroom-schema.sql`.

## Deploy RSS Worker
1. Create a Cloudflare Worker named `thesportzine-newsroom-api`.
2. Deploy `newsroom-worker.js` with the provided `wrangler.toml` or paste it into the Worker editor.
3. Attach `newsroom-api.falsewinger.com` as a Worker custom domain. If using a route, ensure the zone is `falsewinger.com`.
4. Test `https://newsroom-api.falsewinger.com/health` and `/feed` from the newsroom site.
5. The UI currently uses browser local storage for saved stories and desk decisions. Shared users and cross-device persistence require D1 and authenticated endpoints.

## RSS and publisher terms
Configured feeds: BBC Sport Football, Sky Sports Football, BBC Sport Formula 1, Sky Sports Formula 1, Autosport F1 and Motorsport.com F1. Feed availability can change. The Guardian feed is listed in the UI but disabled pending commercial-use permission. Formula1.com is intentionally disabled: its published RSS terms prohibit commercial aggregation and republishing. Check each publisher's current terms before production use. Headlines/excerpts should link directly to the source; do not copy full articles or images.

## Graphics module
The original graphics editor is preserved at `graphics.html`. Its Buffer integration continues to use `buffer-worker.js`; the new hostname must be added to that Worker CORS allowlist.
