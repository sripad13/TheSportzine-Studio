# TheSportzine Studio — Newsroom

The Studio has two modules: **Newsroom** (root) and the original **Graphics editor** at `/graphics.html`.

## Newsroom interface
The root page is a TweetDeck-inspired editorial workspace: independently scrolling, resizable columns; All Sports, Football, Formula 1 and Breaking workspaces; keyword columns; saved stories; and a right-side story inspection drawer. Column layout and saved stories persist in the current browser.

## RSS aggregation API
The Worker exposes:
- `GET /api/health` — service health and D1 status.
- `GET /api/feed` — fetches the configured football and F1 RSS/Atom feeds, extracts headlines/excerpts and source links, and groups exact/near-exact headline matches.

Configured feeds: BBC Sport Football, Sky Sports Football, BBC Sport Formula 1, Sky Sports Formula 1, Autosport F1, Motorsport.com F1 and Formula1.com. Feed availability and formats can change; individual failures are returned in the `feeds` array while other sources continue to load. The initial editorial priority/breaking flags are keyword heuristics, not AI analysis or fact-checking.

### Deploy
1. Deploy `newsroom-worker.js` as the Cloudflare Worker `thesportzine-newsroom-api`.
2. Attach the custom domain `newsroom-api.falsewinger.com`.
3. In the Newsroom header, enter `https://newsroom-api.falsewinger.com` and select **Connect**.
4. Test `https://newsroom-api.falsewinger.com/api/health` and `/api/feed`.
5. D1 is only required for the existing source-management endpoints. Add the binding and apply `newsroom-schema.sql` if you want to use those endpoints; RSS aggregation itself does not require D1.

The Newsroom API CORS allowlist includes `https://newsroom.falsewinger.com` and the GitHub Pages origin. Cloudflare Access should be used to protect the app/API if desired; CORS is not authentication.

## RSS terms and editorial use
Formula1.com is included as requested. Personal use does not by itself establish permission under a publisher's feed terms, so confirm the current terms and keep use within the permitted scope. Feed access is not permission to republish full articles or images. The interface displays headlines and short feed excerpts with links to the publisher. Review each publisher's terms before any wider distribution.

## Graphics module
The original graphics editor remains preserved at `graphics.html`. Its Buffer integration continues to use `buffer-worker.js`; the Newsroom hostname has been added to that Worker's CORS allowlist.
