# TheSportzine Studio — application isolation plan

Canonical site: https://newsroom.falsewinger.com  
Repository: sripad13/TheSportzine-Studio  
Deployment: existing GitHub Pages setup (preserve until a verified migration is approved).

## Target structure

```text
/
├── index.html                 # Common landing page
├── live/                      # Existing production route (preserve during migration)
├── post/                      # Existing production route (preserve during migration)
├── seo/                       # Existing production route (preserve during migration)
├── ideas/                     # Existing production route (preserve during migration)
├── apps/
│   ├── live/index.html        # Isolated app snapshot
│   ├── post/index.html        # Isolated app snapshot
│   ├── seo/index.html         # Isolated app snapshot
│   └── ideas/index.html       # Isolated app snapshot
└── shared/                    # Reserved for cross-app primitives only
```

## Application boundaries

| App | Owns | Must not depend on |
|---|---|---|
| Live | RSS/Atom feeds, source management, Reddit, trends, story desk | Posting editor state, SEO state, Ideas state |
| Post | Graphic editor, templates, image handling, Buffer channels and publishing | Live column state, SEO state, Ideas state |
| SEO | SEO workflows and analysis UI | Live/Post/Ideas runtime |
| Ideas | ChatGPT-powered copy generation and local idea history | Live/Post/SEO runtime |

## Backend boundaries

- `thesportzine-buffer-api` remains a separate Worker. Do not redeploy or modify it as part of frontend isolation.
- `thesportzine-newsroom-api` remains the Newsroom API. Keep route handlers independently scoped.
- OpenAI credentials remain Worker secrets; never expose them in frontend code.
- Do not move secrets, change bindings, alter D1 schema, or change Cloudflare Access policies as part of this frontend-only migration.

## Deployment and rollback policy

1. Production paths remain untouched during the snapshot stage.
2. Compare each snapshot against its existing route and test its critical workflows.
3. Wire route rewrites only after all four apps pass parity checks.
4. Preserve existing URLs and the root landing page.
5. Deploy one route at a time and verify it before moving to the next.
6. Keep the previous route implementation available for immediate rollback.
7. Do not change DNS, repository visibility, Worker names, secrets, or Access policies in this migration.

## Current stage

Stage 1 complete on the migration branch: self-contained snapshots of all four current applications and written ownership/deployment rules.

Not yet complete: extraction of reusable design tokens/navigation, route rewrites, Cloudflare Pages changes, and production cutover. These require parity tests and a deployment check; this branch intentionally does not change production behaviour.
