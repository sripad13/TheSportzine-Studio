# Independent application snapshots

This directory is the isolation boundary for the four Studio applications.

- `live/` — Newsroom Live
- `post/` — Posting Studio
- `seo/` — SEO Studio
- `ideas/` — Social content Ideas

Each application currently has a self-contained `index.html` snapshot copied from its working production route. Inline styles and scripts remain inside their own application. This is intentional for the first migration stage: it creates independent ownership without introducing a bundler, shared runtime, or route changes.

## Important deployment note

The live routes still serve the existing top-level directories:

- `/live/`
- `/post/`
- `/seo/`
- `/ideas/`

The `apps/` snapshots are not wired into production routing yet. Do not delete or replace the existing route directories until each isolated application has passed parity testing and a controlled route cutover.

## Change ownership

A feature change should touch only its owning app unless a documented shared contract must change. Do not put app-specific styles or event handlers in shared code.
