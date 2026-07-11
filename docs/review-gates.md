# Review Gates

These gates keep Murmur shippable without turning every change into process
theater.

## 1. Product review

Audience: teammate, maintainer, or design/engineering reviewer.

Questions:

- Is the user-visible purpose of the change clear?
- Does the change improve a real product path or clarify a real boundary?
- If the change is structural, is the unlock clearly named?
- Does the UI still feel like Murmur?

## 2. Engineering review

Questions:

- Is the scope tight?
- Are architecture boundaries respected?
- Are new dependencies justified?
- Are fallbacks and limitations explicit where needed?
- Is the diff easy to review and reason about?

## 3. Verification review

Run the lightest checks that prove the change:

- `bun run lint`
- `bun run build`
- localhost verification for changed flows when relevant

Record:

- what passed
- what was not run
- what residual risk remains

Repository automation that reinforces these gates lives in
[repository-operations.md](./repository-operations.md).

## Escalate to a design note or ADR when

- saved song compatibility changes
- export behavior changes in a durable way
- auth, AI, or notifications ownership changes
- a new client-side WASM path or device-mode execution path changes the
  transcription fallback contract
- a new external system becomes operationally central
