# @murmur/core

The shell-agnostic algorithm core for Murmur.

**No DOM. No React. No `window`. No framework imports.**

This package is what every shell (Web, Capacitor, 微信 MP) shares: types,
arrangement engine, polisher, payment cost table, EditTokens, entitlement
helpers, i18n dict and translator.

Defined in [`docs/repo-architecture.md`](../../docs/repo-architecture.md) §6.

## Status — 2026-06-03

**Scaffold only.** The real carve-out is Phase 5 of the v2 roadmap
(`docs/execution-roadmap.md`). Files committed today:

- `src/payments/cost-table.ts` — canonical action costs (new in v2).
- `src/auth/entitlements.ts` — pure entitlement resolver.
- `src/music/instrument-ranges.ts` — instrument MIDI range table.
- `src/shared-types/` — placeholder for the type carve-out.
- `src/index.ts` — public re-exports.

Nothing in `apps/web` imports from this package yet. The migration plan
in `docs/repo-architecture.md` §11 sequences the move.

## What goes here

| Folder | Content |
|---|---|
| `arrangement/` | apply-edit.ts, generate-versions.ts, assemble-song.ts (when moved from `apps/web/src/modules/strummer/` and `apps/web/src/lib/music/`) |
| `audio/` | melody-polisher.ts (when the TS-side stays) |
| `auth/` | entitlements.ts, user-types.ts |
| `i18n/` | dict.ts, translator.ts |
| `music/` | chord/bass/drum engines, pitch-engine when TS-side |
| `payments/` | cost-table.ts, sku-types.ts |
| `shared-types/` | MelodyNote, CleanMelody, EditToken, Sku, User, Session |

## What does NOT go here

- React components.
- DOM helpers, canvas, audio-context wrappers.
- Drizzle / Postgres types.
- `framer-motion`, `tone`, `lamejs`, `html2canvas`.

## Import rule

Shells import via `@murmur/core` (root) or `@murmur/core/<subpath>` for
deep imports. The package never imports from any shell.
