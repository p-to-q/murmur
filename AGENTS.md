# Agent Guide

This repository is the standalone Murmur app: a Bun-first Next.js product for
turning hummed melody sketches into editable, saveable songs.

This guide is for coding agents and humans working with coding agents. It keeps
the useful parts of the p-to-q repository discipline while staying specific to
Murmur's actual product shape.

## Core stance

Work as a careful maintainer inside the repository, not as an external code
generator. The goal is the smallest correct change that improves the product,
preserves system clarity, and keeps the app demonstrable.

Read repository truth before changing code. Existing files, routes, UI flows,
docs, and validation commands outrank assumptions from old prompts or generic
best practices.

## Product summary

Murmur's core user journey is:

`Hum -> Vibe -> Studio -> Save -> Gallery -> Song detail`

The product is currently optimized for:

- visible end-to-end creation flow
- stable local demos
- lightweight standalone runtime
- progressive replacement of local stubs with production-ready adapters

## Current architecture

Read these first before making non-trivial changes:

- [README.md](/Users/dujiayi/murmur/README.md)
- [docs/architecture.md](/Users/dujiayi/murmur/docs/architecture.md)
- [docs/delivery-cadence.md](/Users/dujiayi/murmur/docs/delivery-cadence.md)
- [docs/engineering-principles.md](/Users/dujiayi/murmur/docs/engineering-principles.md)
- [docs/review-gates.md](/Users/dujiayi/murmur/docs/review-gates.md)

The main boundaries are:

- `src/app/` — routes, layout, API entrypoints
- `src/components/` — UI and product interaction flows
- `src/modules/` — music, arrangement, and export logic
- `src/lib/api/` — client-side API wrappers
- `src/lib/platform/` — auth, AI, memory, and notifications adapters
- `src/lib/db/` — persistence and query layer

## Commands

```bash
bun install
bun dev
bun run lint
bun run build
bun start
```

Database helpers:

```bash
bun run db:generate
bun run db:migrate
bun run db:push
bun run db:studio
```

## Change discipline

- Make the smallest effective change.
- Preserve working user flows unless the task requires a behavior change.
- Avoid drive-by cleanup, broad rewrites, and dependency churn.
- Prefer extending an existing boundary over inventing a parallel system.
- If a larger cleanup is necessary, say so explicitly instead of hiding it in a
  feature diff.

For non-trivial work, establish:

1. the actual user or system problem;
2. the constraints that are real;
3. the behavior that must stay stable;
4. the smallest valid change;
5. the validation to run.

## Product-specific rules

### 1. Keep platform code behind adapters

Do not spread auth, AI, notification, or memory wiring across feature files.
Anything runtime- or service-specific should route through `src/lib/platform/`
or another narrow adapter boundary.

### 2. Keep the music path legible

Changes to the hum -> arrangement -> save/export path should favor explicit data
flow over hidden coupling. If a change alters saved song compatibility, export
behavior, or arrangement semantics, leave a durable note in docs or the PR.

### 3. Protect the demo path

Guest-safe and demo-safe behavior matters. Prefer a clear fallback over a
hard-stop UI when an external dependency is absent.

### 4. Keep UI changes product-shaped

Murmur is a product surface, not a generic dashboard. Maintain the editorial,
calm, creation-focused tone in layout, copy, density, and interactions.

## Validation

Do not claim success without evidence.

Preferred validation order:

1. narrow manual or targeted check
2. `bun run lint`
3. `bun run build`
4. route or flow verification in localhost when UI changed

When reporting back:

- say exactly what you ran
- say what you did not run
- name any remaining uncertainty

## Documentation expectations

Update docs when changes affect:

- architecture boundaries
- delivery cadence or workflow
- environment variables
- visible user behavior
- known limitations or fallback behavior

## Agent guardrails

Agents should not:

- reintroduce vendor-specific runtime coupling casually
- invent abstractions without a present need
- hide uncertainty
- describe something as fixed without validation
- leave partial structural migrations undocumented

If work is blocked or only partially complete, leave a short handoff note in the
final response or the relevant PR.
