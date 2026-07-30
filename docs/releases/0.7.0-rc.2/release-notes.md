# Murmur v0.7.0-rc.2 (build 440) - Pre-release

This candidate makes the full Hum -> Vibe -> Studio -> Save -> Gallery -> Song
detail path diagnosable and recoverable. It focuses on objectively broken or
unattributable audio, durable delivery, privacy lifecycle, and deliberate
production release control.

## User-visible changes

- Saved songs play through authorized, range-capable audio routes in Gallery,
  Song detail, and public shares.
- Audio download verifies the server response and bytes before reporting
  success; expired sessions, missing audio, throttling, and service errors no
  longer look like successful downloads.
- Share publication verifies readable audio, public links remain revocable,
  and legacy saved songs keep compatible playback where their source remains
  valid.
- Account deletion immediately revokes sessions and shares, blocks concurrent
  song writes, then removes creative data and stored artifacts after 30 days.
- Successful logout or deletion removes account-scoped browser recovery data
  and detaches session-bound Push while keeping language, theme, and other
  device preferences.

## Audio and music reliability

- Web and Worker now exchange versioned hashes and bounded evidence for melody,
  prompt, conditioning, sampling, candidate selection, normalization, runtime,
  and delivered audio.
- Requested conditioning must be proven as applied. Missing or inconsistent
  evidence fails closed after the cutover flag is enabled.
- A versioned signal-quality Gate rejects objectively broken candidates such
  as silent, clipped, fragmented, malformed, or weakly conditioned audio and
  may regenerate within a bounded attempt/time budget.
- Cost remains telemetry, not a delivery Gate. The current Gate does not claim
  to measure taste, composition quality, or listener preference.
- Durable paid jobs persist provider identity, leases, fencing epoch, deadline,
  terminal output, cancellation, settlement, and refund intent. Lost requests
  do not cause blind duplicate GPU submissions.

## Persistence and runtime ownership

- Browser/device storage owns recovery copies: recordings/clips stop restoring
  after 24 hours and drafts after seven days, then a next-start/access sweep
  deletes them best-effort. Browser closure is not a timed-delete guarantee.
- Postgres owns users, Notes, songs, jobs, quality evidence, and object
  lifecycle state.
- Object storage owns final saved masters and durable music-job artifacts;
  same-origin API routes own authorization and delivery.
- Workers own audio/music inference behind server adapters. Browser pYIN is a
  lazy fallback for transcription, not a silent replacement for production
  music generation.
- Data-URL/local song persistence is restricted to explicit local/demo modes.
  Production storage or database failures return typed errors and leave retry
  evidence.
- Preview builds require production-like durable adapters. The release workflow
  independently pulls both Vercel environments and proves their DB, bucket,
  Worker resources, and broad credentials differ; both use Postgres rate limits.

## Release and security

- Production release requires a reviewed, CI-green exact `main` SHA and
  protected Production approval before migrations run.
- Migrations, convergence verification, exact-SHA deploy, immutable/alias smoke,
  tag, and GitHub Pre-release all refer to the same commit.
- Bun dependency audit runs in CI. This candidate resolves the currently known
  Bun audit findings without disabling ESLint or weakening the toolchain.

## Compatibility and rollout

- Migrations through `0032_push_subscription_session_lifecycle` use
  expand-compatible defaults/triggers/indexes; existing songs and the
  synchronous generation route remain supported.
- Keep `NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS` off until a minute-cadence
  external scheduler, real provider canary, and terminal/refund metrics pass.
- Keep music v2 evidence requirements off until the versioned Worker SHA passes
  frozen-dataset warm-up and Web/Worker receipt verification.
- Keep private song-master writes off until controlled read routes pass and
  anonymous `songs/master/*` access is denied by bucket/CDN policy.
- No tag or GitHub Release is created from this branch. Tag `v0.7.0-rc.2` only
  after the final merged `main` SHA passes the production release gates.

## Suggested release identity

- Tag: `v0.7.0-rc.2`
- GitHub title: `Murmur v0.7.0-rc.2 - build 440`
- GitHub release type: pre-release
