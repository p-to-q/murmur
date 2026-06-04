# Docs Index

Murmur's documentation falls into three layers.

## 1. Architecture truth (v1, still current)

How the running system is shaped today. v2 docs build on these; v1 docs
remain the source of truth for everything the v2 docs do not override.

- [architecture.md](architecture.md) — system intent + boundaries
- [music-engine.md](music-engine.md) — chord / bass / drum engines + assemble-song
- [provider-strategy.md](provider-strategy.md) — Stainer transcription facade
- [runtime-surfaces.md](runtime-surfaces.md) — what lives in `src/` and why
- [judges-guide.md](judges-guide.md) — code + design judge orientation
- [engineering-principles.md](engineering-principles.md) — philosophy parent
- [delivery-cadence.md](delivery-cadence.md)
- [review-gates.md](review-gates.md)
- [packaging-and-release.md](packaging-and-release.md)
- [verification.md](verification.md)

## 2. v2 plan — narrative (2026-06)

The "why" and the "what" of the v2 cutover. Read in this order; each
builds on the previous.

1. [diagnosis-2026-06.md](diagnosis-2026-06.md) — codebase reality
   check with file paths.
2. [audio-pipeline-redesign.md](audio-pipeline-redesign.md) —
   server-authoritative hum → score pipeline.
3. [cross-platform-strategy.md](cross-platform-strategy.md) — Web,
   Capacitor, Taro, shared backend.
4. [studio-compose-redesign.md](studio-compose-redesign.md) — three-
   plane Compose surface.
5. [payment-topup-feature.md](payment-topup-feature.md) — credits,
   top-up, billing.
6. [execution-roadmap.md](execution-roadmap.md) — sequenced 0–7
   phases.

## 3. v2 plan — contracts (2026-06)

The hard surfaces — types, schemas, conventions, standards. Codex reads
these on every PR.

- [page-contracts.md](page-contracts.md) — per-page state + APIs + JSON.
- [user-model.md](user-model.md) — identity, plans, entitlements,
  regions, sessions.
- [data-model.md](data-model.md) — every Postgres table + invariants.
- [api-conventions.md](api-conventions.md) — REST shape, error
  envelope, auth, idempotency, webhooks.
- [repo-architecture.md](repo-architecture.md) — monorepo layout,
  workspaces, import rules, naming.
- [engineering-standards.md](engineering-standards.md) — per-PR
  bar; the companion to `engineering-principles.md`.
- [testing-strategy.md](testing-strategy.md) — unit / API / golden
  master / e2e.
- [observability.md](observability.md) — logs, metrics, traces,
  dashboards.

## 4. Handoff

- [codex-handoff-prompt.md](codex-handoff-prompt.md) — the full prompt
  to dispatch the v2 work to Codex. Read by humans before pasting; read
  by Codex as the working brief.

## How agents should use this

- Need to **understand current state** → §1 + `diagnosis-2026-06.md`.
- Need to **decide what to build next** → `execution-roadmap.md`.
- Need to **implement a page** → `page-contracts.md` + the relevant
  feature doc + `studio-compose-redesign.md` if it's Compose.
- Need to **add a route** → `api-conventions.md` + the feature doc.
- Need to **touch the DB** → `data-model.md`.
- Need to **change repo structure** → `repo-architecture.md`.
- Need to **set the bar for a PR** → `engineering-standards.md`.

The v2 docs supersede v1 architecture / music-engine / provider-
strategy **only where they explicitly say so.** Anything else, v1
remains authoritative.

If a v2 doc disagrees with the actual code: the doc is right + the
code is the next PR. If two v2 docs disagree: the more specific doc
(contracts > narrative) wins, and the conflict gets a note in
`engineering-standards.md`.
