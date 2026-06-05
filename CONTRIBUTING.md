# Contributing to Murmur

Thanks for helping with Murmur. This repo is product-first: we prefer small,
reviewable changes that keep the end-to-end creation flow demonstrable.

## Before you change code

Read these first:

- [README.md](./README.md)
- [AGENTS.md](./AGENTS.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/review-gates.md](./docs/review-gates.md)

## Local setup

```bash
bun install
cp .env.example .env
bun dev
```

Audio-worker changes may also need:

```bash
python -m pip install -r workers/audio-engine/requirements.txt
```

## Working style

- Keep one branch to one reviewable change.
- Make the smallest effective edit.
- Preserve demo-safe fallbacks when external services are unavailable.
- Put service-specific wiring behind `src/lib/platform/`.
- Leave docs updated when behavior, architecture, or env contracts change.

## Validation

Run the lightest set that proves your change:

```bash
bun run lint
bun test
bun run build
```

If you changed the audio worker, also run:

```bash
bun run test:audio
```

If you changed full-dataset or closure logic, also run:

```bash
bun run test:audio:full
```

In your PR, say:

- what you ran
- what you did not run
- what residual risk remains

## Pull requests

Use the built-in PR template. Reviewers should be able to answer in under a
minute:

- what changed
- why it changed
- what the biggest risk is
- how it was validated

## Support codes and bug reports

User-facing failures should carry a support code in the form:

`<AREA>-<ERROR>-<SHORTID>`

Example:

`HUM-WORKER_UNAVAILABLE-Y72ZLB`

When reporting a bug, include the support code, rough timestamp, and product
surface if you have them.
