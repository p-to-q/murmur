# Docs Index

Status: canonical documentation registry<br>
Owner: product engineering<br>
Last verified: 2026-07-18

Murmur documentation has five roles: current reference, contract, decision,
roadmap, and historical evidence. Executable code, schema, configuration, and
tests describe what actually runs. Canonical docs explain that reality and the
intent behind it. A disagreement is documentation drift to resolve, not a rule
that either side automatically wins.

## 1. Architecture truth (v1, still current)

How the running system is shaped today. v2 docs build on these; v1 docs
remain the source of truth for everything the v2 docs do not override.

- [architecture.md](architecture.md) — system intent + boundaries
- [product-engineering-system.md](product-engineering-system.md) — product,
  latency, reliability, and architecture decision framework
- [worker-architecture.md](worker-architecture.md) — deployed worker topology,
  capacity, and operational constraints
- [music-jobs.md](music-jobs.md) — durable paid-generation lifecycle,
  recovery, settlement, and production cutover
- [tech-stack.md](tech-stack.md) — current stack + deploy topology (Vercel /
  RunPod / Waffo / local cloudflared)
- [music-engine.md](music-engine.md) — chord / bass / drum engines + assemble-song
- [melody-intent-and-vocal-card.md](melody-intent-and-vocal-card.md) —
  melody intent profile + lightweight vocal-card repair direction
- [provider-strategy.md](provider-strategy.md) — Stainer transcription facade
- [billing-waffo.md](billing-waffo.md) — web payments (Waffo) + idempotent
  note grants
- [runtime-surfaces.md](runtime-surfaces.md) — what lives in `src/` and why
- [judges-guide.md](judges-guide.md) — code + design judge orientation
- [engineering-principles.md](engineering-principles.md) — philosophy parent
- [delivery-cadence.md](delivery-cadence.md)
- [review-gates.md](review-gates.md)
- [packaging-and-release.md](packaging-and-release.md)
- [repository-operations.md](repository-operations.md) — authoritative
  production migration, exact-SHA deploy, smoke, and branch-governance runbook
- [verification.md](verification.md) — validation commands and current evidence

## 2. v2 plan — narrative (2026-06)

The "why" and the "what" of the v2 cutover. Read in this order; each
builds on the previous.

1. [diagnosis-2026-06.md](archive/diagnosis-2026-06.md) — codebase
   reality check with file paths (archived 2026-06 snapshot).
2. [audio-pipeline-redesign.md](audio-pipeline-redesign.md) —
   server-authoritative hum → score pipeline.
3. [cross-platform-strategy.md](cross-platform-strategy.md) — Web,
   Capacitor, Taro, shared backend.
4. [studio-compose-redesign.md](studio-compose-redesign.md) — three-
   plane Compose surface.
5. [payment-topup-feature.md](payment-topup-feature.md) — credits,
   top-up, billing.
6. [execution-roadmap.md](execution-roadmap.md) — historical migration
   sequencing; do not use it as the current backlog.

## 3. v2 plan — contracts (2026-06)

The hard surfaces — types, schemas, conventions, standards. Codex reads
these on every PR.

- [page-contracts.md](page-contracts.md) — bridge to current page intent and
  partial contract notes; gaps are explicit in the document.
- [user-model.md](user-model.md) — identity, plans, entitlements,
  regions, sessions.
- [data-model.md](data-model.md) — every Postgres table + invariants.
- [api-conventions.md](api-conventions.md) — REST shape, error
  envelope, auth, idempotency, webhooks.
- [repo-architecture.md](repo-architecture.md) — current repository layout,
  workspaces, import rules, naming, and local artifact hygiene.
- [engineering-standards.md](engineering-standards.md) — per-PR
  bar; the companion to `engineering-principles.md`.
- [testing-strategy.md](testing-strategy.md) — unit / API / golden
  master / e2e.
- [observability.md](observability.md) — logs, metrics, traces,
  dashboards.

## 4. Archive — historical snapshots

Frozen, point-in-time docs from the 2026-06 v2 cutover and earlier
audits. They record how the system got here; they are **not** current
truth. Full index in [archive/README.md](archive/README.md). The handoff
briefs that drove the v2 work live there:

- [codex-handoff-prompt.md](archive/codex-handoff-prompt.md) — the full
  prompt that dispatched the v2 work to Codex.
- [handoff-ui-agent.md](archive/handoff-ui-agent.md) — the UI-agent
  handoff brief.

## How agents should use this

- Need to **understand current state** → §1 + `tech-stack.md`
  (`archive/diagnosis-2026-06.md` for the file-level 2026-06 snapshot).
- Need to **decide what to build next** → `product-engineering-system.md`,
  current issues, and measured production evidence.
- Need to **implement a page** → `page-contracts.md` + the relevant
  feature doc + `studio-compose-redesign.md` if it's Compose.
- Need to **add a route** → `api-conventions.md` + the feature doc.
- Need to **touch the DB** → `data-model.md`.
- Need to **change repo structure** → `repo-architecture.md`.
- Need to **set the bar for a PR** → `engineering-standards.md`.

## Fast start for new maintainers

If you only have 15 minutes to rehydrate on the repo, read in this order:

1. `README.md` — product shape + local runtime commands.
2. `architecture.md` — current boundaries and runtime flow.
3. `repository-operations.md` — production release and migration contract.
4. `delivery-cadence.md` — what a "good-sized" Murmur change looks like.
5. `engineering-principles.md` — how to change the repo without adding drift.
6. `review-gates.md` + `verification.md` — what counts as proof before merge.

Historical plans do not supersede current references merely because they are
newer. When current references disagree, inspect the running boundary and
tests, record the product decision, then update code and documentation in the
same change where practical.
