# Changelog

All notable product releases for Murmur are documented here. SemVer lives in
`package.json`. Build numbers live in `src/lib/release-metadata.ts`.

## [0.7.0-rc.2] - 2026-08-01

### Added

- Versioned music input, conditioning, candidate, normalization, and quality
  evidence across the Web and both Worker transports
- A deterministic signal-quality Gate with bounded candidate regeneration and
  independent Web verification before delivery
- Leased, fenced durable music-job dispatch with explicit ambiguous-submission,
  expiry, cancellation, artifact, settlement, and refund states
- Authorized owner/public song-audio routes with byte ranges, downloads,
  revocable sharing, and production smoke support
- Durable song-audio object receipts and retryable cleanup, plus 30-day
  account-deletion cleanup for creative data and stored artifacts
- Bun dependency auditing in CI and patched production/tooling dependencies

### Changed

- Production release is a protected, manually approved exact-`main`-SHA action
  ordered as validate, migrate, verify, deploy, and smoke
- Production fallbacks now fail closed instead of silently treating browser
  state, data URLs, in-memory stores, or local identity as canonical data
- Preview resource isolation, durable hosted rate limiting, and the object-store
  temporary-data lifecycle are enforced by environment audit
- Account deletion serializes with song writes; successful logout/deletion
  clears account-scoped device data while retaining device preferences
- Saved MP3/WAV input and storage delivery now use bounded structural
  validation, ETag/Range semantics, and explicit missing/corrupt outcomes
- Version prepared as `0.7.0-rc.2`, build `461`

### Release status

- This is a pre-release candidate. Publication still requires reviewed PRs,
  green CI on the final `main` SHA, migrations through `0034`, external
  scheduler evidence, exact-SHA Production deployment, real-audio smoke, and a
  human Save -> Gallery -> Download -> Share -> Revoke check.

## [0.7.0-rc.1] - 2026-07-18

### Added

- Durable, idempotent music-generation job contracts with persisted state,
  artifact storage, recovery, cancellation, and settlement boundaries
- A browser-level Playwright golden path covering creation, save, Gallery,
  Song detail, sharing, and public playback
- Ordered production release automation: CI, migration, schema verification,
  exact-SHA deployment, then production smoke checks
- Stable experiment assignments for evaluating an optional Studio step and
  canonical-draft-first persistence independently
- Indexed composition-event capture and documentation for future product,
  feedback, and model-quality analysis

### Changed

- Hardened the Hum-to-Song journey with bounded waits, recoverable generation,
  clearer failure handling, and safer local/demo fallbacks
- Restored and refined Home recording, Vibe generation, Gallery, Song export,
  sharing, and Top Up behavior without adding new blocking steps
- Tightened checkout idempotency, email-verification concurrency, storage
  cleanup, observability, and music-engine health reporting
- Version prepared as `0.7.0-rc.1`, build `409`

### Release status

- This is a pre-release candidate. Production cutover still requires green CI,
  migration and schema verification, exact-SHA deployment, and production smoke
  evidence for the selected commit.

## [0.6.0] - 2026-07-11

### Added

- Browser-side WASM pYIN pitch detection via Essentia.js as a third-tier
  transcription fallback when the audio worker is transiently unavailable
  (`src/lib/audio/client-pitch-fallback.ts`)
- Transient error classification service (`src/lib/errors/transient.ts`) with
  centralized `isTransient()`, `classifyError()`, `classifyHttpStatus()` across
  routes, workers, and client
- Per-component latency budgets (`src/lib/observability/latency-budgets.ts`)
  with P50/P95 ceilings for transcribe, music_generate, llm_edit, db operations
- Stage-based funnel tracking (`src/lib/observability/stage-tracking.ts`) for
  hum → vibe → studio → save → gallery drop-off observability
- SongCard memo, reduced-motion preference support, ISR caching
  (`minimumCacheTTL: 3600`), and AVIF/WebP image optimization
- Per-route error boundaries (`src/components/murmur/route-error-screen.tsx`)
  for Gallery, Studio, Song, Topup, Me with contextual retry and back actions
- CSP security headers (report-only) applied globally
- Architecture diagrams (Mermaid) in README covering system overview,
  hum → song pipeline, and transcription fallback resilience

### Changed

- Version bumped to 0.6.0, build bumped to 181
- All docs updated to reflect client-side WASM fallback, latency budgets,
  stage tracking, and the v0.6.0 architecture
- `docs/` date stamps calibrated to 2026-07-11 across audio, architecture,
  delivery, and verification documents
- Stainer facade extended to three paths: server → client WASM → fixture
- `TranscriptionResult.provider` now accepts `"client_pyin"`
- Review gates expanded to cover client-side WASM and device-mode execution
  contract changes
- Engineering principles now codify client-side fallback and observability
  requirements

## [0.5.0] - 2026-07-04

### Added

- Hybrid app version display on the Me screen (`v0.5.0 · 110`)
- Developer-mode expanded version string with build number and git SHA
- Release metadata contract, formatter tests, and drift checks in CI

### Changed

- Calibrated the product version from the legacy `v0.2.0` hackathon label to
  `0.5.0`
- Unified SemVer source of truth in `package.json`
- Structured logs now emit `release` as `0.5.0+build.110.<sha>`
- MCP server metadata now reads the app SemVer

### Milestones reflected in this release

- `0.2.0` — core creation loop and music engine v2 foundation
- `0.3.0` — auth, persistence, and deployment readiness
- `0.4.0` — billing, public share, and launch hardening
- `0.5.0` — notification delivery and post-launch polish
