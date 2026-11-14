# Studio — Brand and Interface Redesign Plan

Status: In progress
Repository: sripad13/TheSportzine-Studio
Implementation branch: feature/studio-rebrand-migration
Production branch: main (unchanged; do not deploy or merge before acceptance)

## 1. Approved decisions

- Product name: **Studio**.
- Official supplied brand assets are authoritative.
- Brand palette: lime `#B7D957`, near-black `#0B0B0D`, white `#FFFFFF`.
- Light surfaces: `#F5F6F2` and `#FFFFFF`; dark surfaces: `#0B0B0D` and `#171916`.
- Theme choices: System, Light and Dark, with a persistent browser preference.
- Shared navigation order: Newsroom, Create, Optimize, Audit.
- The current hostname and all existing route paths remain unchanged. URL migration is a separate future task.
- Existing app logic, APIs, Workers, D1 data and integrations must be preserved.

## 2. Current route map (unchanged in this phase)

| Existing route | Purpose |
|---|---|
| / | Studio landing page |
| /live/ | Newsroom workspace |
| /live/sources/ | Newsroom source management |
| /post/ | Create / graphics and publishing workspace |
| /seo/ | Optimize |
| /ai-audit/ | AI visibility audit |
| /ai-audit/site/ | Full-site audit |
| /ai-audit/prepublish/ | Pre-publish checker |
| /graphics.html | Original graphics editor |

Do not introduce redirects, change canonical hosts or rename paths in this phase.

## 3. Shared shell

- Shared header markup is generated from `assets/studio/studio.js` and styled by `assets/studio/studio.css`.
- Every application page uses the same header structure, official wordmark, dimensions, navigation order, theme control and responsive mobile menu.
- Only the active navigation state changes by route.
- Theme selection cycles through System, Light and Dark and is persisted in local storage.
- Official logo variants and icon are stored in `brand/`.
- Preserve each page's existing local toolbar and workflow controls beneath the shared global header.

## 4. Visual system

- Restrained, editorial and functional; avoid glossy effects, gradients, glow, glassmorphism and decorative 3D.
- One palette across the landing page, Newsroom, Create, Optimize, Audit, nested audit tools and graphics editor.
- Lime is a restrained brand accent, not a large-area background.
- Use neutral surfaces, strong readable typography, subtle borders and minimal shadows.
- Respect reduced-motion preferences, keyboard navigation and visible focus states.
- Ensure mobile layouts do not clip scores, panels or controls.

### Landing page content

1. Clear Studio proposition and primary entry point.
2. Four product entry points: Newsroom, Create, Optimize and Audit.
3. A concise explanation of the connected editorial workflow.
4. Footer links to The Sportzine, portfolio and graphics editor.

## 5. Integration and data boundaries

- Keep the current application host and current API host unchanged.
- Preserve `newsroom-api.falsewinger.com` and all existing API paths and response contracts.
- Preserve the existing Newsroom API Worker, Buffer Worker, D1 database, database identifiers, schemas and records.
- Do not change Cloudflare DNS, GitHub Pages custom-domain settings, Cloudflare Access, Worker CORS or redirect rules.
- Preserve GA4, AdSense, Instagram and Buffer configuration.
- Do not perform destructive migrations or change authentication behaviour.

## 6. Regression requirements

- Verify Newsroom feeds, source management and suggested websites.
- Verify Create drafts, graphics editor and Buffer publishing.
- Verify Optimize SEO, AEO and GEO checks and existing article editor layout.
- Verify Audit single-page, full-site and pre-publish workflows, including D1-backed history.
- Verify desktop and mobile navigation, theme persistence, focus visibility and reduced motion.
- Check browser console/network errors and horizontal overflow.
- Confirm all existing deep links and API requests continue to work.

## 7. Future URL migration (not part of this release)

The planned future destination is `studio.falsewinger.com`, with `newsroom.falsewinger.com` retained as a permanent redirect entry point. That migration requires a separate implementation and acceptance cycle covering DNS, Pages hosting, TLS, Cloudflare Access, CORS, redirects, canonical metadata, sitemap, OAuth origins and end-to-end regression. No such changes are made by this redesign.

## 8. Release and rollback

- Work only on `feature/studio-rebrand-migration`.
- Keep `main` and the live deployment untouched until the redesign is reviewed and accepted.
- Retain the current deployment and configuration as the rollback baseline.
- Merge/deploy only after explicit approval and regression checks.
