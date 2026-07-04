# Changelog

All notable product releases for Murmur are documented here. SemVer lives in
`package.json`. Build numbers live in `src/lib/release-metadata.ts`.

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
