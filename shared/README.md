# Shared Studio foundation

This folder is reserved for genuinely cross-application primitives only.

Planned shared responsibilities:

- Design tokens: colours, typography, spacing, borders and focus states.
- Header/navigation contract and active-section state.
- Small, dependency-free API helpers where request/response behaviour is identical.
- Authentication/session integration only after Cloudflare Access behaviour is confirmed.

## Isolation rules

1. No application imports another application's JavaScript or CSS.
2. Shared modules must not initialise app-specific features.
3. Shared navigation must be presentational; it must not own application state.
4. A change to shared code requires smoke tests across all four apps.
5. Keep Buffer publishing and its Worker isolated from Live, SEO and Ideas.
6. Keep the Newsroom API and app-specific endpoints independently testable.

No runtime shared modules are introduced in this foundation commit. This avoids changing behaviour before parity testing.
