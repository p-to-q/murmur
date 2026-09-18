# 0.7.0-rc.2 Verification

Prepared version: `0.7.0-rc.2`

Build: `461`

Release date: 2026-08-02

Status: `SHIPPED AND READY FOR INVITED TRIAL`

Released SHA: `ddddac221cedf44d7dd2f0301ed375119b4cb12f`

Production: `https://murmur.ptoq.io`

Release workflow: `https://github.com/p-to-q/murmur/actions/runs/30742381293`

GitHub Pre-release: `https://github.com/p-to-q/murmur/releases/tag/v0.7.0-rc.2`

The exact SHA passed protected preflight, three-profile real-provider canary,
database migration/catalog verification, immutable deployment smoke, Production
promotion, and alias smoke. The release receipt is recorded in issue #455.
Subjective musicality remains an explicit post-publication acceptance item in
issue #201; it is not implied by this technical release verdict.

The workflow automatically proves deployment identity, Worker calls, technical
quality evidence, and existing owner/public audio delivery. The release captain
also recorded the live Save -> Gallery -> Play -> Download -> Share -> Public
play -> Revoke journey. Authenticated scheduler success, cleanup retry, and an
after-promotion rollback exercise were not independently automated by this run;
they remain operational follow-up evidence rather than hidden release claims.

## Repository evidence

- Bun tests: 1,281 pass, 0 fail, 4,456 assertions across 191 files after final
  release hardening;
- release evidence/database/Vercel/music focused suites pass with zero failures;
- audio Worker suite: 47 pass, 0 fail; music Worker mock suite: 43 pass, 0 fail;
- pinned HumTrans valid-split evidence passes 8/8 `auto` cases with zero
  warn/fail/error (average pitch 0.887, feel 0.822); the real production RunPod
  canary passed all three profiles, while human musicality review remains in
  issue #201;
- lint, application TypeScript, test TypeScript, Markdown link audit, and webpack
  production build pass; the integrated build contains 64 routes;
- Playwright creation golden path passes Hum -> Vibe -> Studio -> Save ->
  Gallery playback -> non-empty audio download -> Share -> public playback in
  Chromium;
- frozen install succeeds and `bun audit` reports no vulnerabilities;
- integrated release PR #440 superseded the earlier stacked PRs and is merged.
  Release-tail PR #454 supplied the post-merge Preview contract, and fixes
  #457-#461 closed provider reproducibility, Quality Gate alignment, operation
  evidence, and production job-lease failures before the final release run.

The authoritative repository evidence is the green required checks on the
final `main` SHA. Local results do not replace review or CI.

## Environment contract

| Environment | Canonical state | Worker/storage behavior | Allowed fallback |
| --- | --- | --- | --- |
| Test | in-memory/mocked fixtures | memory object store and mock Workers | deterministic fixtures only |
| Local dev | local Postgres or explicit demo adapters | local filesystem plus loopback Workers | guest/header/data-URL behavior only when explicitly enabled |
| Preview | isolated Postgres and explicit `MURMUR_DEPLOYMENT_ENV=preview` | DB/bucket/audio/music identities and broad credentials must differ from Production | fail closed for registered persistence; feature flags remain canary-only |
| Production | Postgres, S3-compatible object store, server sessions | exact-SHA Web plus versioned remote Workers | no browser/local/data-URL canonical fallback |

Required Production configuration includes pooled runtime Postgres, an
unpooled migration DSN, `CRON_SECRET`, S3-compatible storage credentials,
session/auth secrets, the selected music transport credentials, and Vercel
release credentials. Release workflow validation fails closed when its required
configuration is absent. Production must set
`MURMUR_STORAGE_TMP_LIFECYCLE_CONFIRMED=true` only after verifying the bucket's
24-hour `tmp/` lifecycle. Hosted Preview/Production rate limiting is Postgres;
`memory` and `redis` are rejected.

Preview evidence is not a prose assumption. Every Preview build blocks unsafe
misconfiguration. Missing bucket or Worker provisioning is reported as a warning
so ordinary PR builds remain possible, and those routes fail closed at runtime.
Before a Preview is used as release evidence, provision its isolated resources
and set `MURMUR_PREVIEW_REQUIRE_FULL_STACK=1`; the protected release workflow
then queries Vercel project, deployment, Rolling Release, and environment
metadata. It requires a READY Preview whose Git metadata matches the exact final
PR head and whose Git tree matches the released merge. It compares opaque
database identity, bucket and Worker resource markers, and distinct Sensitive
record IDs without decrypting credentials. Never copy credential values into a
PR or release note.
The preflight also binds Preview and Production runtime Worker URLs/endpoints to
their resource markers. Production builds expose only a SHA-256 fingerprint of
the approved non-secret identities; immutable and alias smoke compare it with
the fingerprint captured before mutation and immediately before deploy.

## Release gate checklist

The following pre-release checklist is retained as historical planning context.
The linked workflow and #455 receipt, not unchecked prose below, are the
authoritative record of what rc.2 executed. Future releases must gather fresh
evidence rather than reusing either source.

1. Confirm integrated release PR #440 is merged and its superseded stacks are
   closed only after their commits are accounted for. Review and merge final
   release-tail PR #454 to `main`. Required review and checks remain fail-closed.
2. Confirm #454's exact final head has a green Vercel Preview and the repository's
   required `verify` check before merge. Use PR #454's exact number, head SHA, and
   branch as the protected release workflow's Preview provenance inputs.
3. Confirm the final `main` SHA has green `verify`, CodeQL, dependency review,
   Bun/Python audits, bundle budget, and Vercel Preview.
4. Prove the actual migration-writer DSN is the approved runtime database before
   its first write. Apply migrations through `0034`; re-run journal convergence and the explicit
   catalog/data-invariant verifier on the same SHA. Record the informational
   legacy null-session Push count, and fail if the superseded
   `push_subscriptions_active_session_required_check` exists.
5. On a production clone, prove old-app/new-schema compatibility, migration
   counts, lock duration, and application rollback with the expanded schema.
6. Verify external music (minute) and song-audio (15-minute) schedulers send
   `Authorization: Bearer $CRON_SECRET` and record one successful invocation.
7. Verify one `tmp/` canary expires under the bucket lifecycle within 24 hours.
8. Approve the billing/refund record purpose, access roles, retention schedule,
   and final deletion/anonymization policy; record the owner and review date.
9. Complete issue #445, including protected credential migration, fresh Vercel
   dashboard acknowledgement, frozen evidence, three-profile real provider
   canary matrix, and human listening review; do not enable v2/durable-job flags
   without acceptance.
10. Dispatch `Release (production)` from `main` with the full final SHA, final
    PR number/head/branch, and approve Release Evidence then Production.
    Production must hold the endpoint-scoped RunPod key used to re-attest one
    pinned profile before mutation and again immediately before deploy.
11. Require immutable-deployment and alias smoke with both real share and owner
    audio fixtures configured. Before promotion, the immutable deployment also
    runs a real transcription and quality-gated music generation through its
    own Vercel Worker credentials, verifies evidence persistence, exact Worker
    revision, and delivered audio SHA-256. The fixed owner must have at least
    two Notes available; these two successful canary operations settle one Note
    each and use stable release-derived operation IDs for safe workflow reruns.
12. In a real browser, verify Save -> Gallery -> Play -> Download -> Share ->
   Public play -> Revoke and one failed object cleanup followed by retry.
13. Tag that exact SHA as `v0.7.0-rc.2` and publish a GitHub Pre-release using
    `release-notes.md`.

## Rollback

- Keep durable jobs, v2 evidence enforcement, and private song-master writes
  independently disabled until each canary is accepted.
- Application rollback promotes the last known-good exact-SHA deployment.
- Migrations `0027`-`0034` are expand-compatible. Do not run down migrations while a
  deployed Web/Worker can still reference jobs or stored audio receipts.
- A storage-cleanup incident is recovered by fixing the dependency and retrying
  leased outbox rows; never delete committed receipts to make dashboards green.
