# Workflow Contract

This file describes how issues, PRs, humans, and coding agents cooperate in the
Murmur repository. It is intentionally light.

## Sources of truth

1. Issues or explicit task statements define the work.
2. Pull requests carry implementation and review context.
3. Docs carry durable architecture and workflow decisions.
4. Chat is temporary unless summarized into one of the above.

## Default working mode

- one branch = one logical change
- one PR = one reviewable outcome
- no direct pushes to `main`
- keep the worktree clean before handoff or merge

## Good agent-sized work

Work is a good fit for one pass when:

- the acceptance outcome is concrete
- the scope fits one review sitting
- the change can be validated locally
- the task is not primarily open-ended strategy debate

## Handoff expectation

For multi-step or interrupted work, leave a short note with:

- current status
- files changed or read first
- validation already run
- remaining risk or next step

## Merge expectation

Before merging:

- the PR says what changed and why
- validation is explicit
- docs are updated if boundaries or behavior changed
- known limitations are not hidden

## Current Murmur cadence

See [docs/delivery-cadence.md](/Users/dujiayi/murmur/docs/delivery-cadence.md).
Default rhythm is one visible outcome per week, with smaller PRs merged along
the way.
