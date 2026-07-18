# Murmur v0.7.0-rc.1 (build 409) - Pre-release

This candidate closes the largest reliability gaps in Murmur's core journey
before a production release. It keeps the calm product shape while making
creation, payment-adjacent generation, save, playback, export, sharing, and
deployment more recoverable and observable.

## Highlights

### A journey that can finish

- Home recording keeps bounded recovery paths when microphone access,
  transcription, or an upstream service is unavailable.
- Vibe generation can surface usable takes progressively and recover work by
  stable operation identity instead of charging or generating twice.
- Gallery remains useful for an empty account, while Song playback, real file
  downloads, share-link copying, and public playback use explicit success and
  failure outcomes.
- Top Up preserves the established compact visual treatment while checkout
  creation is protected against duplicate submissions.

### Durable music generation

- New persisted music jobs model accepted, queued, running, result-ready,
  settlement, cancellation, failure, expiry, and unknown-submission outcomes.
- Stable user/operation identity, request-hash conflict detection, leases, and
  transactional note settlement make retries idempotent.
- Generated audio is stored before settlement so a settlement retry does not
  regenerate or charge again.
- Client adoption remains feature-flagged for candidate validation; the legacy
  synchronous endpoint remains available during the cutover.

### Release safety

- The production workflow is ordered as CI -> migration -> schema verification
  -> exact-SHA deploy -> smoke verification.
- Production smoke checks verify the immutable deployment and the production
  alias instead of assuming a successful build means a healthy release.
- CI includes a real Chromium golden path through Hum, Vibe, Studio, Save,
  Gallery, Song detail, sharing, and public playback.

### Product learning without forced UX

- Stable, independently assignable experiments can test whether Studio should
  be skippable and whether a canonical draft should be persisted earlier.
- Both experiments default off. This candidate does not force a new journey
  before evidence supports it.
- Composition events preserve account, recording, generation, edit, save, and
  feedback relationships for indexed product and model-quality analysis.

## Compatibility and rollout

- Database migrations `0026` and `0027` must complete before this SHA is
  deployed.
- Existing saved songs and the synchronous music-generation endpoint remain
  supported.
- Durable client generation should only be enabled after its database,
  storage, provider, and recovery checks pass in the target environment.
- No Git tag or GitHub Release should be created until this exact candidate is
  merged to `main` and the ordered production gates are green.

## Candidate verification

The release contract is checked with:

```bash
bun test src/lib/release-contract.test.ts src/lib/app-version.test.ts
```

The complete release decision also requires the repository CI suite, browser
golden path, migration verification, exact-SHA deployment, and production smoke
checks to pass for the same commit.

## Suggested release identity

- Tag: `v0.7.0-rc.1`
- GitHub title: `Murmur v0.7.0-rc.1 · build 409`
- GitHub release type: pre-release
