# Repo Architecture

This document describes the repository shape Murmur actually uses today. It is
the placement guide for code, tests, scripts, docs, and assets. Future
multi-shell plans live in [cross-platform-strategy.md](cross-platform-strategy.md)
and [execution-roadmap.md](execution-roadmap.md); they do not override this
current-state contract until the directories exist in the repo.

## Current Top-Level Layout

```text
murmur/
├── src/                         # Next.js app, API routes, UI, app-side logic
├── packages/
│   └── murmur-core/             # Pure TypeScript shared domain helpers
├── workers/
│   ├── audio-engine/            # Python FastAPI hum transcription worker
│   └── music-engine/            # Python music generation worker / RunPod handler
├── public/                      # Served static assets
├── scripts/                     # Small operator, QA, deploy, and audit scripts
├── docs/                        # Current docs plus explicit archives
├── .github/                     # GitHub workflows and collaboration surfaces
├── package.json                 # Bun workspace root and command registry
└── compose.yaml                 # Local Postgres helper
```

Murmur is still a single Next.js product shell at the repo root. There is no
`apps/web` directory yet. Do not move files into an `apps/*` layout as part of
ordinary cleanup work.

## Source Boundaries

### `src/app/`

Next.js App Router pages, layouts, loading/error boundaries, metadata routes,
and API route handlers. Keep route handlers thin: validate inputs, call the
right library or adapter boundary, and return the documented response shape.

Examples:

- `src/app/page.tsx`
- `src/app/api/transcribe/route.ts`
- `src/app/api/billing/webhook/route.ts`

### `src/components/`

React UI. The current subdirectories are:

- `screens/` — page-level product flows such as `HumScreen`,
  `StudioScreen`, and `SongDetailScreen`.
- `murmur/` — app shell, navigation, brand, loading, and cross-page affordances.
- `studio/`, `gallery/`, `song-detail/`, `user-profile/`, `auth/` —
  feature-scoped UI.
- `ui/` — small generic primitives used by product components.

Screen components may be large while a flow is changing quickly. Split them
when the split improves reasoning around an active product surface, not just to
make a file tree look flatter.

### `src/modules/`

Product-specific transformation logic that should stay understandable outside
framework glue. This includes export rendering, Strummer edits, Stainer
transcription normalization, and music version contracts.

Keep the hum -> arrangement -> save/export path explicit. Any change that
alters saved song compatibility, export behavior, or arrangement semantics
needs a durable note in docs or the PR.

### `src/lib/`

Runtime support code used by routes and components.

- `api/` — client-side fetch wrappers.
- `auth/` — session/auth helpers.
- `db/` — Drizzle schema, migrations, and query layer.
- `platform/` — runtime/service adapters for auth, AI, workers, memory,
  notifications, and payments.
- `music/` — local arrangement and playback helpers.
- `storage/`, `rate-limit/`, `billing/`, `observability/`, `i18n/` — named
  support domains.
- `hooks/`, `store/`, `user/`, `audio/`, `http/`, `qa/`, `test/` — focused
  app-side helpers.

Do not spread vendor-specific auth, AI, notification, storage, worker, or
billing wiring into feature files. Add or extend a narrow adapter instead.

### `src/presets/`

Checked-in product presets such as vibes and artwork catalog data. Runtime
assets referenced from these files must exist under `public/`.

### `packages/murmur-core/`

Pure TypeScript domain helpers shared through the Bun workspace. This package
currently owns small, shell-agnostic surfaces:

- auth entitlements
- instrument ranges
- payment cost table
- shared types

Rules for this package:

- no React, DOM, Next.js, Drizzle, browser storage, or vendor SDK imports;
- export intentionally from `packages/murmur-core/src/index.ts`;
- keep tests next to the pure helpers they cover.

### `workers/`

Auxiliary Python services. They are runtime-adjacent but not bundled into the
Next.js app.

- `workers/audio-engine/` handles audio transcription and audit tooling.
- `workers/music-engine/` handles Magenta / music generation locally and via
  RunPod serverless.

Worker virtual environments, Python bytecode, local datasets, and generated
reports are local artifacts. They should stay out of source control.

## Static Assets

`public/` contains assets served directly by the app: icons, manifest assets,
share images, artwork, and background-ready derivatives. Before deleting an
asset, check at least:

- `public/manifest.json`
- `src/app/layout.tsx`
- `src/presets/artworks/catalog.ts`
- `src/components/**`
- `src/modules/export/**`

Artwork archive materials under `docs/artwork-archive/` are historical source
records, not runtime assets.

## Docs

Use `docs/README.md` as the index.

- Current architecture and operation docs live directly in `docs/`.
- Historical notes live under `docs/archive/`.
- Phase-plan leftovers should be archived once their work is complete.
- If code and docs disagree, verify the code first, then update the doc or open
  a follow-up note rather than preserving conflicting guidance.

## Scripts

Scripts belong in `scripts/` when they are small operator, QA, deploy, audit, or
maintenance entrypoints. Add a `package.json` script when a command is expected
to be reused by maintainers or CI.

Avoid one-off script sprawl. If a script is only useful once, prefer a short
cleanup note in docs instead of checking it in permanently.

## Naming And Imports

- File names are generally `kebab-case.ts` / `kebab-case.tsx`.
- React component exports are `PascalCase`.
- Hooks are `useCamelCase`.
- Tests live beside the unit they cover as `<unit>.test.ts` or under the
  relevant worker `tests/` directory.
- App-local TypeScript imports use `@/*`.
- Shared package imports use `@murmur/core` or `@murmur/core/*`.

The root `tsconfig.json` maps the active aliases. Do not add aliases for
directories that do not exist.

## Generated And Local Files

These are not source:

- `.next/`
- `node_modules/`
- `*.tsbuildinfo`
- `next-env.d.ts`
- `.env` and `.env.*` except `.env.example`
- worker `.venv/`, `__pycache__/`, local datasets, and generated reports
- `.murmur/` local object-storage output

If one appears in `git status`, update `.gitignore` or remove the local artifact
instead of committing it.

## Migration Boundaries

The repo already has a small `packages/murmur-core` workspace, but the app has
not completed the larger multi-shell carve-out. A future move to `apps/web`,
additional shared packages, Capacitor, or Taro should be handled as explicit
architecture work with its own validation plan.

Until that work starts, the production-grade shape is:

1. keep runtime code in the current boundaries;
2. move only proven pure helpers into `packages/murmur-core`;
3. keep external services behind `src/lib/platform/`;
4. keep worker build/runtime state out of git;
5. keep docs aligned with code instead of documenting aspirational paths as
   current truth.
