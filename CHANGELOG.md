# Changelog

All notable product releases for Murmur are documented here. SemVer lives in
`package.json`. Build numbers live in `src/lib/release-metadata.ts`.

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
