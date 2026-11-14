# Studio — Brand and Interface Redesign Plan

Status: Approved implementation baseline
Current host: newsroom.falsewinger.com (unchanged in this phase)
Domain migration: explicitly deferred
Repository: sripad13/TheSportzine-Studio
Implementation branch: feature/studio-rebrand-migration
Production branch: main (must remain untouched until acceptance)

## 1. Locked product decisions

- Brand: Studio
- Visual direction: restrained, editorial and functional; light and dark themes available throughout
- Current domain and routes remain unchanged until a separate URL migration is approved
- Global navigation, in exact order: Newsroom, Create, Optimize, Audit
- All application pages must use the exact same shared header component and responsive behaviour.

## 2. Canonical route map

| Legacy | Canonical |
|---|---|
| https://newsroom.falsewinger.com/ | https://studio.falsewinger.com/ |
| /live | /newsroom |
| /live/ and /live/index.html | /newsroom |
| /live/sources | /newsroom/sources |
| /live/sources/ | /newsroom/sources |
| /post | /create |
| /post/ and /post/index.html | /create |
| /seo | /optimize |
| /seo/ and /seo/index.html | /optimize |
| /ai-audit | /audit |
| /ai-audit/ and /ai-audit/index.html | /audit |
| /ai-audit/site/ | /audit/site/ |
| /ai-audit/prepublish/ | /audit/prepublish/ |

Retain query strings and fragments where possible. Normalize trailing slashes consistently. Add redirects for any additional discovered deep links before launch; do not silently drop nested audit workflows or existing graphics tools.

## 3. Architecture and implementation principles

1. Inventory the actual static-site structure and all navigation/link references before moving files.
2. Extract a single shared header implementation (and shared footer where practical) used by every page. Do not maintain copied per-page headers.
3. Keep the header DOM, dimensions, logo treatment, type scale, navigation order, mobile menu, focus states and responsive breakpoints identical. Only the active navigation state may vary.
4. Use canonical route paths in internal links. Legacy aliases must redirect, not render duplicate content.
5. Keep existing application logic and API contracts isolated from the visual refactor.
6. Preserve existing app modules and tools, including the graphics editor and any nested audit pages, even if they are not in the four primary navigation items.
7. Use progressive enhancement: navigation and core content must remain usable without decorative animation.
8. Meet accessible contrast, keyboard navigation, visible focus, reduced-motion and semantic landmark requirements.

## 4. Visual system

### Approved brand identity

- Product name: Studio (exactly; do not use “The Studio” or “THE STUDIO”).
- Use the official supplied horizontal SVG wordmarks and icon from `brand/`.
- Primary lime: `#B7D957`; near-black: `#0B0B0D`; white: `#FFFFFF`.
- Light theme surfaces: `#F5F6F2` and `#FFFFFF`; dark theme surfaces: `#0B0B0D` and `#171916`.
- One shared palette across the landing page and every application page.
- Theme choices: System, Light and Dark; persist the selection across pages.
- No glossy effects, gradients, glow, glassmorphism or decorative 3D.


- Light is the default; Dark is a complete alternate theme, with System following the operating-system preference.
- Neutral surfaces, near-black text, muted secondary text and restrained borders.
- The supplied lime is the only brand accent.
- Typography-led hierarchy, generous whitespace, consistent content widths and calm card treatments.
- Motion is subtle and purposeful; no unnecessary 3D scenes, heavy gradients, glow effects or decorative clutter.
- Responsive from narrow mobile through desktop; no horizontal overflow or clipped scores/panels.

### Landing page content

1. Hero: THE STUDIO with a concise proposition about creating, managing and publishing sports content.
2. Four product entry points: Newsroom, Create, Optimize, Audit.
3. Product storytelling sections that explain the purpose and value of each tool.
4. Clear calls to action into the relevant application.
5. Compact footer linking to The Sportzine, portfolio and relevant product destinations.

## 5. Infrastructure and integration boundaries

- GitHub Pages: attach studio.falsewinger.com to the production Pages deployment only after the new host is provisioned and verified.
- Legacy hostname: keep newsroom.falsewinger.com and its DNS/zone. Configure an edge-level permanent redirect from legacy host to the new canonical host, with explicit path mapping. Do not point the old host at a dead origin.
- Cloudflare Access: add the new hostname to the existing application policy and test login/session behaviour before redirecting production traffic.
- Newsroom API: preserve https://newsroom-api.falsewinger.com and all current API paths. The API hostname is not the application hostname.
- Worker CORS: allow https://studio.falsewinger.com; retain https://newsroom.falsewinger.com during migration and for any required compatibility window. Do not remove other legitimate origins.
- D1 and Workers AI: preserve existing DB and AI bindings, database identifiers, schemas and records. No database recreation or destructive migration.
- Buffer Worker: add the new Studio origin while retaining the old origin until validation is complete.
- GA4, AdSense and Instagram: preserve credentials/configuration and verify their current flows on the new origin. Update authorized origins/redirect URIs only where the provider explicitly requires it.
- Avoid changing API endpoint names or response contracts as part of the hostname/route migration.

## 6. SEO and URL hygiene

- Set canonical URLs to studio.falsewinger.com.
- Update sitemap, robots references, Open Graph URLs, structured-data URLs, manifest/start URLs and internal absolute links where present.
- Ensure legacy URLs return a single-hop 301 to the matching canonical destination.
- Do not redirect every deep link to the homepage; preserve intent and route mapping.
- Keep API routes out of page redirects.
- Verify no duplicate indexable pages remain on the legacy hostname.
- Update Search Console properties and analytics hostname reporting after launch.

## 7. Implementation phases

### Phase A — Repository audit
- Enumerate every HTML page, script, stylesheet, asset and route.
- Identify all header implementations and route references.
- Search for hard-coded newsroom.falsewinger.com origins.
- Map app-to-Worker calls, storage keys, OAuth origins and nested paths.
- Record baseline screenshots and smoke-test existing functionality.

### Phase B — Shared shell and design system
- Add shared design tokens and shared header/footer.
- Migrate all app pages to the shared shell without changing app logic.
- Verify exact header parity across Newsroom, Create, Optimize and Audit.
- Implement mobile navigation and active-route state.

### Phase C — Landing page and canonical routes
- Redesign the root page to the approved Apple-inspired direction.
- Add canonical route entry points for /newsroom, /create, /optimize and /audit.
- Preserve /newsroom/sources and nested audit pages.
- Preserve graphics editor and other existing utility paths.

### Phase D — Domain migration (deferred)

- Do not change DNS, GitHub Pages custom domains, Cloudflare Access, Workers CORS or redirects in this redesign phase.
- Keep newsroom.falsewinger.com and every existing route operational.
- Revisit host migration only as a separate approved release after the visual redesign is accepted.

### Phase F — Regression and release
- Provision studio.falsewinger.com and validate TLS, Pages hosting and Access.
- Add the new origin to Workers' CORS allowlists.
- Configure legacy host redirects with explicit path mappings.
- Test both www/non-www variants only if they currently exist; do not invent extra hostnames.

### Phase E — Regression and release
- Run route, responsive, accessibility, console/network and integration tests.
- Verify RSS, Sources, suggested websites, Create drafts, Buffer, SEO, AEO, GEO, AI audit, D1 history, analytics and Instagram metrics.
- Validate all redirects and canonical metadata.
- Deploy to production only after acceptance; retain rollback to the previous deployment.

## 8. Acceptance criteria

- [ ] Current newsroom.falsewinger.com routes continue to resolve unchanged.
- [ ] Landing page follows the approved Studio brand system and supports System, Light and Dark themes.
- [ ] Newsroom, Create, Optimize and Audit all render the exact same shared header.
- [ ] Active route state is correct without changing header structure or dimensions.
- [ ] Desktop and mobile navigation work and remain accessible.
- [ ] All legacy routes map to the correct new route with a single 301.
- [ ] Nested Sources and Audit routes remain reachable.
- [ ] Graphics editor and other existing tools remain reachable.
- [ ] API Worker hostname and endpoint contracts remain unchanged.
- [ ] D1 data and bindings remain intact.
- [ ] Buffer, GA4, AdSense and Instagram integrations pass regression tests.
- [ ] Newsroom feeds, Sources and suggested websites pass regression tests.
- [ ] SEO, AEO, GEO and crawler audit workflows pass regression tests.
- [ ] No broken internal links, uncaught console errors or horizontal overflow.
- [ ] Production main is updated only after review and explicit release approval.

## 9. Rollback

Keep the existing GitHub Pages deployment, hostname and Worker configuration unchanged throughout the redesign. If the redesign fails, revert the redesign branch/deployment; there is no hostname cutover in this phase. Never delete the old hostname, database, Worker or production branch as part of rollback.

## 10. Current implementation notes

- The shared header is delivered from `assets/studio/studio.js` and styled by `assets/studio/studio.css`.
- Official logo variants are stored under `brand/`.
- The header order is Newsroom, Create, Optimize, Audit; active state is route-derived.
- The theme selector cycles System, Light and Dark and persists the choice in local storage.
- Existing application workflows, API paths, hostnames and route paths are intentionally preserved.

## 11. Open technical verification items

The repository is currently a static-site style project and its full file inventory must be confirmed before choosing the least invasive shared-shell implementation. Confirm the current GitHub Pages custom-domain setup, Cloudflare DNS proxy/redirect capabilities, Access application hostname rules, Buffer Worker CORS configuration, and any OAuth authorized origins before production cutover.
