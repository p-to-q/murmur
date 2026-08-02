# Murmur v0.7.0-rc.2 (build 461) - Pre-release

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
- Audio responses retain a one-release `mp3Url` alias to the same controlled
  API route so already-open N-1 clients keep playback, download, and sharing
  during cutover without exposing object-storage keys.
- Account deletion immediately revokes sessions and shares, blocks concurrent
  song writes, then removes creative data and stored artifacts after 30 days.
- Successful logout or deletion removes account-scoped browser recovery data
  and detaches session-bound Push while keeping language, theme, and other
  device preferences.

## Audio and music reliability

- Web and Worker now exchange versioned hashes and bounded evidence for melody,
  prompt, conditioning, sampling, candidate selection, normalization, runtime,
  and delivered audio.
- Synchronous generation records a stable, digest-bound evidence row before it
  settles billing or returns audio. Evidence failure refunds and fails closed,
  while a same-operation retry cannot create a second charge.
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

## Provider reproducibility (build 461)

- The music-engine image pins its `magenta-rt` provider version. It was
  previously unpinned, so a rebuild silently adopted the 2026-07-30 release and
  every generation returned zero candidates in ~340 ms. A release image is now
  reproducible and the provider version moves only in a reviewed commit.
- A failed generation reports its failure stage. The Worker previously returned
  `generation_failed` with no reason, which made a provider regression
  undiagnosable from release evidence.

- Music generation no longer fails on every request. The job-lease update
  interpolated a raw `Date` into a `sql` template, so Postgres received
  `"Sun Aug 02 ... (Coordinated Universal Time)"` and rejected the statement
  with `invalid input syntax for type timestamp`. Verified against the
  production database.
- Synchronous music generation now declares `X-Murmur-Operation-Replayed`.
  Only the durable path emitted it, so a synchronous response carried no
  operation evidence and a caller could not distinguish a fresh provider call
  from a replayed receipt.

### Quality Gate

- A quiet run bounded by audio on both sides now fails the technical Gate as
  `interior_dropout`, at exactly the bar the release provider canary enforces.
  The Gate measured these but kept them as shadow evidence, so a clip with a
  hole in the middle was delivered as a pass while the release bar rejected it;
  `prolonged_silence` could not catch them because that threshold scales with
  duration. Gaps below the dropout threshold stay clean, so staccato and rests
  are unaffected, and retries lower sampling temperature to suppress the
  degenerate silence rather than re-rolling blindly.

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
- Preview builds block unsafe configuration and fail closed on unprovisioned
  runtime routes. The protected release preflight requires the final Preview's
  durable adapters, verifies Vercel metadata without decrypting Sensitive
  values, proves Preview/Production resources and credential records differ,
  and binds the READY deployment to the exact PR head and release Git tree.

## Release and security

- Production release requires a reviewed, CI-green exact `main` SHA, protected
  Release Evidence approval for read-only/provider proof, and a separate
  protected Production approval before migrations run.
- Before promotion, the immutable deployment performs one real transcription
  and one quality-gated generation through its own Vercel runtime credentials,
  then verifies persisted evidence, Worker revision, and delivered audio hash.
- Migrations, convergence verification, exact-SHA deploy, immutable/alias smoke,
  tag, and GitHub Pre-release all refer to the same commit.
- Bun dependency audit runs in CI. This candidate resolves the currently known
  Bun audit findings without disabling ESLint or weakening the toolchain.

## Compatibility and rollout

- Migrations through `0034_transcription_operation_receipts` use
  expand-compatible defaults/triggers/indexes; existing songs, legacy
  null-session Push rows, and the synchronous generation route remain
  supported. New Push writes still require an owned persistent session.
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
- GitHub title: `Murmur v0.7.0-rc.2 - build 461`
- GitHub release type: pre-release
