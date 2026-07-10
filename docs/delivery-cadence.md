# Murmur Delivery Cadence

This is a lightweight delivery rhythm for Murmur. It borrows the useful parts of
the p-to-q `repo-template`: visible artifacts, explicit limits, and short
handoff-friendly writing. It skips the heavier research or governance routes
unless a change actually needs them.

## Default mode

Use a one-week delivery loop with a single primary outcome.

### At the start of the week

Write a short pitch in the issue, PR description draft, or handoff note:

- user problem
- visible artifact we expect by the end of the week
- constraints and known unknowns
- what we are intentionally not doing yet

Keep it small enough that one merge can still feel decisive.

## Work sizing

Prefer three sizes:

- `S`: one focused PR, half day to one day
- `M`: one outcome, one to three PRs, fits in a week
- `L`: too big; split before starting implementation

Anything that spans multiple uncertain systems should be reduced until the first
merge creates a visible product gain.

## Delivery contract

Every merge should leave behind:

1. a user-visible improvement, or
2. a boundary-cleaning change that clearly unlocks the next visible improvement

If a change is purely structural, the PR should say what it unlocks next.

## Review checklist

Before merging, verify:

- localhost works
- changed routes or flows are manually exercised
- `bun run lint` passes
- `bun run build` passes for meaningful runtime changes
- limitations are written down when the system still uses a stub or fallback

## When to add more process

Only add extra ceremony when one of these is true:

- a decision changes persisted data or export compatibility
- an external service becomes operationally important
- the work needs more than one handoff to finish
- the team cannot explain current direction in a short paragraph

When that happens, add one small artifact:

- architecture note
- ADR
- execution checklist

Not all three.

## Current Murmur focus areas

In order, the healthiest next bets are:

1. Make the standalone runtime production-real, especially auth and notification
   adapters.
2. Tighten the hum -> arrangement -> save path so it is predictable and easy to
   demo.
3. Productionize the client-side WASM pitch fallback into a full device-mode
   execution path for offline-first and privacy-sensitive flows.
4. Persist repair provenance, melody-choice stance, and edit lineage in
   saved-song metadata for longitudinal comparison.
5. Split large UI files only when doing so reduces confusion around ongoing
   product work.
