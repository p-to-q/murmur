# Runtime Surfaces

This document is a factual map of what kinds of files exist in Murmur and what
they are for. It is meant to reduce ambiguity for engineers deciding where code
belongs and what should or should not be shipped.

## 1. Runtime source files

These files are part of the app's runtime behavior and should be treated as
product code.

### App shell and routes

- `src/app/`
  Next.js routes, layouts, page entrypoints, and API route handlers.

Examples:

- `src/app/page.tsx`
- `src/app/gallery/page.tsx`
- `src/app/api/songs/route.ts`

### Product UI

- `src/components/`
  User-facing screens, controls, nav, visual components, and UI primitives.

Examples:

- `src/components/screens/HumScreen.tsx`
- `src/components/studio/track-mixer.tsx`
- `src/components/song-detail/song-visual-canvas.tsx`

### Product logic

- `src/modules/`
  Product-specific logic that should remain understandable outside framework
  glue, especially export and music-generation flows.
- `src/lib/`
  Core shared libraries including audio pipeline, error handling, and
  observability infrastructure.

Examples:

- `src/modules/export/export-video.ts`
- `src/modules/strummer/generate-versions.ts`
- `src/lib/audio/client-pitch-fallback.ts`
- `src/lib/audio/build-client-transcription-result.ts`
- `src/lib/errors/transient.ts`
- `src/lib/observability/latency-budgets.ts`
- `src/lib/observability/stage-tracking.ts`

### Shared runtime libraries

- `src/lib/`
  Runtime support code such as DB access, API clients, platform adapters, music
  engines, stores, and i18n.

Important subgroups:

- `src/lib/platform/` — auth, AI, memory, notifications adapters
- `src/lib/db/` — persistence and queries
- `src/lib/music/` — lower-level music helpers and assembly
- `src/lib/api/` — client-side API wrappers
- `src/lib/audio/` — client-side pitch detection fallback and transcription result builders
- `src/lib/errors/` — shared error classification for retry/observability decisions
- `src/lib/observability/` — latency budgets, stage tracking, logging
- `src/lib/store/` — client application state
- `src/lib/storage/` — object-store adapters, validated song-audio delivery,
  and retryable object lifecycle helpers

### Worker/runtime-adjacent services

- `workers/`
  Auxiliary services used by runtime features but not bundled into the Next.js
  app itself.

Current example:

- `workers/audio-engine/main.py`

## 1.1 Runtime ownership matrix

| Data or capability | Device/browser copy and retention | Canonical service owner | Failure/fallback policy |
| --- | --- | --- | --- |
| Web UI, icons, artwork | Installed app bundle or normal HTTP cache; deployment-versioned | Exact-SHA Web deployment/CDN | No service-worker offline shell is promised in this release |
| Pitch runtime | Lazy-loaded browser WASM/model cache when server transcription needs rescue | Audio Worker is the production transcription owner | Browser pYIN is explicit reduced-quality recovery, never music generation |
| Last hum recording | IndexedDB `murmur-recordings`, one slot, recoverable for at most 24 hours; swept on the next app start/access and cleared after success/reset/account exit | Device owns it until upload | Browser closure is not a timed-delete guarantee; storage denial degrades to no recovery copy, not a failed recording |
| Unsaved creation draft | `localStorage` `murmur-creation-draft-v1`, recoverable for at most seven days; swept on the next app start/access | Device owns it until save | Corrupt/expired drafts are deleted when storage is next available; production never promotes them to saved songs |
| Generated recovery clips | IndexedDB `murmur-generation`, recoverable for at most 24 hours; swept on the next app start/access and cleared on flow reset/account exit | Device recovery copy plus durable job state when enabled | Browser closure is not a timed-delete guarantee; a stable operation id resumes rather than repurchases |
| Notifications and preferences | Notification inbox is account-scoped and cleared at exit; language/theme/currency/audio preferences remain until browser data is cleared | Postgres/Push owns delivery; device owns preferences | Logout atomically revokes session Push and locally unsubscribes the browser endpoint |
| Account, Notes, songs, jobs, quality evidence | Response/UI cache only | Postgres through `src/lib/db/` | Production DB failures are typed errors; local/demo adapters require explicit mode |
| Durable raw hum | No canonical browser copy after accepted upload | Private object `tmp/`, 24-hour bucket lifecycle | Production build requires lifecycle acknowledgement; adapter TTL metadata is not deletion |
| Final saved master and job output | Current render/download Blob only | S3-compatible object store plus Postgres lifecycle receipts | Local filesystem in dev; data URLs only for legacy/local-demo compatibility |
| Playback/share/download authorization | Session cookie or revocable share capability | Same-origin Next.js API | Missing/corrupt objects return typed 404/410; raw credentials never reach clients |
| Audio and music inference | No preinstalled production model beyond lazy browser pitch fallback | Versioned remote Workers behind `src/lib/platform/` | Loopback/mock Workers require explicit local/test configuration |

Fallbacks keep a local demo usable but do not change production ownership.
Production failures return typed errors and preserve retry evidence instead of
silently promoting browser storage, embedded audio, or an in-memory adapter to
canonical state.

Preview is production-like but not production-backed. The Preview build audit
requires durable adapters and rejects local fallbacks. Before Production
approval, the release workflow independently pulls the actual Preview and
Production Vercel environments and compares database identity, object bucket,
Worker endpoints, and cross-environment credentials without logging values.
Both hosted environments use Postgres-backed rate limits; process memory is
test/local only.

## 2. Build and validation support

These are engineering support files. They are not user features, but they are
necessary to build, validate, or operate the product.

- `package.json`
- `bun.lock`
- `next.config.ts`
- `postcss.config.mjs`
- `tsconfig.json`
- `eslint.config.mjs`
- `drizzle.config.ts`
- `vercel.json`
- `scripts/`

Current script example:

- `scripts/local-stack-smoke.ts`
- `scripts/page-contract-smoke.ts`

## 3. Static assets

These are checked-in files that the app can serve directly.

- `public/`

Examples:

- `public/favicon.ico`
- `public/favicon.png`
- `public/icon.png`
- brand, manifest, share-card, or artwork assets

## 4. Documentation surfaces

These files explain the product, architecture, verification state, or workflow.
They are not runtime inputs unless explicitly consumed by tooling.

- `README.md`
- `AGENTS.md`
- `WORKFLOW.md`
- `docs/`

## 5. Build output

These files are generated and should not be treated as authored source.

### Local build output

- `.next/`
  Next.js build output used for local or deployment builds.

### TypeScript incremental output

- `tsconfig.tsbuildinfo`
  Local compiler cache artifact.

### Installed dependencies

- `node_modules/`
  Dependency installation output.

## 6. User-facing export artifacts

These are not source files. They are generated by Murmur for end users.

Current product export surfaces:

- MP3 audio
- WAV fallback audio
- poster PNG
- self-contained share HTML
- audio-backed shareable video (MP4 first, WebM fallback)

These are produced by code under:

- `src/modules/export/render-mp3.ts`
- `src/modules/export/render-wav.ts`
- `src/modules/export/export-video.ts`
- `src/components/song-detail/ShareTicketCard.tsx`

## 7. What belongs where

Use this quick rule set:

- If it changes live app behavior, it belongs in `src/` or `workers/`.
- If it validates, configures, or deploys the app, it belongs in root config or
  `scripts/`.
- If it explains the system or process, it belongs in `docs/`, `README.md`,
  `AGENTS.md`, or `WORKFLOW.md`.
- If it is something a Murmur user downloads, it is an export artifact, not a
  source artifact.
