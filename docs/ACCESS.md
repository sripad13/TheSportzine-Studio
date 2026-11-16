# Studio access (Cloudflare Access)

The landing page (`/`) is public. Every other Studio page requires a Cloudflare Access sign-in.
`/letzgo` is an unlinked sign-in entry. It redirects into a protected page, which triggers the Access login. It is not a security control on its own: Access is.

## Set up in Cloudflare Zero Trust

1. **Login method:** Settings → Authentication → add *One-time PIN*. Sign-in is by a code emailed to the allowed address, so there is no password to manage.
2. **Policy:** one reusable policy, *Allow*, Include → Emails → the owner's address only.
3. **Application (Studio pages):** Access → Applications → Self-hosted. Domain `studio.thesportzine.com`, with these paths added as separate destinations:
   - `/letzgo`
   - `/newsroom` and `/newsroom/*`
   - `/share` and `/share/*`
   - `/create`, `/optimize`, `/audit` (and their `/*` paths), or the new names once the route rename is merged
   - Leave `/`, `/brand/*`, `/assets/*` and `/demo/*` out, so they stay public.
   Attach the policy above. Session duration: one month is reasonable.
4. The Studio host must be proxied (orange cloud) through Cloudflare for path rules to apply.
5. Test in a private window: `/` loads without a prompt, and `/newsroom/` and `/letzgo` prompt for the PIN.

## Open items

- **Read access to `/api/links` is currently public.** `GET /api/links` returns every short link and its destination, with no sign-in check. Protecting the pages does not protect this data. Options: an Access application on the API host (the browser calls the API cross-origin, so that needs testing), or a read key checked by the Worker.
- The API host (`newsroom-api`) is not behind Access yet. Writes are only blocked by the Studio write key, so `STUDIO_WRITE_KEY` should also be set on the Worker.
- `studio.thesportzine.com` is not live yet. Until the Pages cutover, the same rules apply to `newsroom.falsewinger.com`.
