# 0.7.0-rc.2 Verification

Prepared version: `0.7.0-rc.2`

Build: `440`

Candidate date: 2026-07-30

Status: `NO-GO` until every production-evidence item below is complete on the
same merged `main` SHA.

## Repository evidence

- Bun tests: 1,189 pass, 0 fail after final release hardening;
- release environment isolation focused tests: 13 pass, 0 fail;
- audio Worker suite: 47 pass, 0 fail; music Worker mock suite: 43 pass, 0 fail;
- audio closure smoke passes its required synthetic baseline. Optional Vocadito
  and Murmur-golden manifests are absent locally, so frozen real-data evidence
  and the real provider canary remain GO prerequisites;
- lint, application TypeScript, test TypeScript, Markdown link audit, and webpack
  production build pass; the integrated build contains 64 routes;
- Playwright creation golden path passes Hum -> Vibe -> Studio -> Save ->
  Gallery -> Share -> public playback in Chromium;
- frozen install succeeds and `bun audit` reports no vulnerabilities;
- PRs #441 and #442 currently have green machine checks. PRs #443 and #440
  pass repository CI but their Vercel Preview deployments fail after the strict
  Preview environment contract is introduced. The Vercel project owner must
  inspect the private deployment log, correct the real Preview configuration,
  and obtain a green deployment on the final stack before release;
- stacked PR machine checks must be re-proven after each rebase.

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

Preview evidence is not a prose assumption. Its build must pass the production-
like env audit, then the protected release workflow independently pulls both
actual Vercel environments and compares database identity, bucket, Worker
endpoints, and broad credentials. It prints only field names and pass/fail
results. Record the non-secret identities in approval evidence; never copy
credentials into a PR or release note.

## Required release sequence

1. Merge release-governance PR #436 before feature PRs so partial merges cannot
   auto-deploy to Production.
2. Merge the reviewed stack #433 -> #434 -> #439 -> #435 -> #437 -> #438 ->
   #441 -> #442 -> #443, then this release PR #440, with required checks green
   at every boundary.
3. Confirm the final `main` SHA has green `verify`, CodeQL, dependency review,
   Bun/Python audits, bundle budget, and Vercel Preview.
4. Apply migrations through `0032`; re-run journal convergence and the explicit
   catalog/data-invariant verifier on the same SHA.
5. On a production clone, prove old-app/new-schema compatibility, migration
   counts, lock duration, and application rollback with the expanded schema.
6. Verify external music (minute) and song-audio (15-minute) schedulers send
   `Authorization: Bearer $CRON_SECRET` and record one successful invocation.
7. Verify one `tmp/` canary expires under the bucket lifecycle within 24 hours.
8. Approve the billing/refund record purpose, access roles, retention schedule,
   and final deletion/anonymization policy; record the owner and review date.
9. Run frozen music evaluation and a real provider canary; do not enable v2 or
   durable-job flags without accepted evidence.
10. Dispatch `Release (production)` with the full final `main` SHA and approve
   the protected Production environment.
11. Require immutable-deployment and alias smoke with both real share and owner
   audio fixtures configured.
12. In a real browser, verify Save -> Gallery -> Play -> Download -> Share ->
   Public play -> Revoke and one failed object cleanup followed by retry.
13. Tag that exact SHA as `v0.7.0-rc.2` and publish a GitHub Pre-release using
    `release-notes.md`.

## Rollback

- Keep durable jobs, v2 evidence enforcement, and private song-master writes
  independently disabled until each canary is accepted.
- Application rollback promotes the last known-good exact-SHA deployment.
- Migrations `0027`-`0032` are expand-compatible. Do not run down migrations while a
  deployed Web/Worker can still reference jobs or stored audio receipts.
- A storage-cleanup incident is recovered by fixing the dependency and retrying
  leased outbox rows; never delete committed receipts to make dashboards green.
