# Closure Audit

This note is the short, current-state answer to three product-engineering
questions:

1. what is Murmur's mainline right now?
2. how well is the current implementation supporting it?
3. what should happen next?

It is intentionally evidence-first. If this note drifts from repository truth,
the code, scripts, and workflow files win.

## 1. Mainline

Murmur's mainline is not "all audio AI things." It is the trustworthy creation
path:

`Hum -> Vibe -> Studio -> Save -> Gallery -> Song detail`

Everything else should support that path:

- audio capture and transcription should be robust enough that the user feels
  understood;
- arrangement and export should stay aligned so previews do not lie;
- fallback behavior should preserve momentum without hiding systemic failure;
- local development and CI should be able to prove whether the stack is healthy.

Current repo evidence:

- [docs/architecture.md](./architecture.md)
- [docs/repository-operations.md](./repository-operations.md)
- [docs/verification.md](./verification.md)
- [scripts/local-stack-smoke.ts](../scripts/local-stack-smoke.ts)

## 2. Current implementation quality

The repo is materially healthier than the fast-build starting point.

What is now true:

- the local web app and audio worker can be smoke-checked together;
- the primary page shells can be smoke-checked as routes, not just inferred
  from lower-level API health;
- deep QA links now exist for stateful mid-journey screens:
  `/vibe?demo=1`, `/studio?demo=1`, and `/studio/name?demo=1`;
- those QA links are now part of the automated page-contract smoke, not only
  manual browser verification;
- `bun run verify:local` gives a compact operator gate;
- CI now runs lint, link checks, Bun tests, Python worker tests, and build audit;
- the hum flow has explicit support-code rules instead of leaking raw request
  IDs or showing engineering detail on every transient failure;
- fixture rescue is constrained so it saves a healthy session without masking a
  broken system indefinitely;
- build warnings are now governed: the current known Turbopack warning is
  acknowledged, and any new warning should fail the gate.

What is still incomplete:

- `next build` still emits one non-blocking Turbopack NFT tracing warning for
  the dev-only local storage route;
- browser-level unattended verification of the full product path is still
  thinner than the API / module / worker coverage;
- some docs still contain historical references to deleted provider paths and
  should be kept clearly archival or retired.

## 3. What should happen next

Priority order:

1. keep strengthening unattended verification of the mainline flow, especially
   one browser-level check that proves the visible creation path still mounts
   and advances;
2. either eliminate the remaining Turbopack NFT warning or document the exact
   upstream/tooling reason it cannot currently be removed;
3. continue retiring stale architecture references so new work follows today's
   storage, worker, and fallback model instead of ghost paths;
4. expand audio acceptance around the product goal, not just raw note
   extraction: "sounds like what I sang" and "still sounds musical."

The principle for future work is simple:

Do not optimize Murmur into a generic platform. Make the creation path more
trustworthy, more testable, and more musically believable.
