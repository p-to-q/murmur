# Repository Operations

This document describes the operational governance that keeps Murmur reviewable,
maintainable, and safe to iterate on.

For the short, current-state product-engineering assessment, also see
[docs/closure-audit.md](./closure-audit.md).

## Scope

This document covers repository hygiene, review entry points, automation, and
the **production deployment and migration topology** as it actually runs today.
It does not define product roadmap priority.

## Baseline automation

Murmur now uses standard GitHub-native governance surfaces instead of ad hoc
repo rituals:

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
  runs the fast required gate on PRs and pushes to `main`: lint, link checks,
  TypeScript/Bun tests, audio-worker tests, build audit, a real local-stack
  smoke against the built app plus a live worker, and the Chromium golden path
  from capture recovery through public playback.
- [`.github/workflows/audio-acceptance.yml`](../.github/workflows/audio-acceptance.yml)
  runs the heavier unattended audio acceptance loop on a weekday schedule and
  on manual demand, then uploads the generated reports as artifacts.
- [`.github/workflows/dependency-review.yml`](../.github/workflows/dependency-review.yml)
  blocks high-severity incoming dependency risk on PRs.
- [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml)
  runs GitHub Advanced Security's static analysis for TypeScript and Python.
- [`.github/workflows/stale.yml`](../.github/workflows/stale.yml)
  closes abandoned issues and PRs after a cooling period.
- [`.github/workflows/link-check.yml`](../.github/workflows/link-check.yml)
  validates local Markdown links with a cheap deterministic check on a schedule
  and by manual trigger.
- [`.github/workflows/label-sync.yml`](../.github/workflows/label-sync.yml)
  keeps the repo's label set aligned with the checked-in taxonomy.
- [`.github/workflows/labeler.yml`](../.github/workflows/labeler.yml)
  and [`.github/workflows/issue-labeler.yml`](../.github/workflows/issue-labeler.yml)
  add lightweight automatic labels to PRs and issues.
- [`.github/dependabot.yml`](../.github/dependabot.yml)
  opens weekly dependency maintenance PRs for Bun/npm, Python, and GitHub
  Actions.

These are deliberately common templates with Murmur-specific tuning, so the repo
inherits familiar operator behavior instead of custom process logic.

Two of these jobs are gated behind repository variables so a fork without GitHub
Advanced Security does not get red builds it cannot act on. Turn the scans on
under **Settings → Secrets and variables → Actions → Variables**:

```
ENABLE_GHAS_CODEQL=true        # enable the CodeQL static-analysis job
ENABLE_DEPENDENCY_REVIEW=true  # enable the incoming-dependency review gate
```

The split between `ci.yml` and `audio-acceptance.yml` is intentional:

- PR feedback should stay fast enough to use continuously.
- Full audio closure and report generation should still happen regularly, but
  without making every UI or docs change wait on the heaviest suite.
- The repo no longer pretends the deleted `basic-pitch-service` worker is a
  supported fallback path; verification now targets `workers/audio-engine`
  directly so stale infrastructure cannot silently mask breakage.
- CI now also proves that the built Next.js app and a live worker can boot
  together and satisfy the same compact smoke contract used by local operators.
- That compact smoke now includes page-contract checks for the primary route
  shells (`/`, `/gallery`, `/me`, `/studio`, `/vibe`), so repo health is not
  inferred from APIs alone.

## Production topology and deployment

This is the settled state, not a proposal. A new maintainer should be able to act
from this section.

### Hosting and deploy

Production runs on Vercel, but GitHub Actions owns the production release
sequence. Vercel's native Git integration remains useful for pull-request
Previews and **must not auto-deploy `main` to Production**.

- **Preview:** the native Git integration creates Preview deployments.
- **Production:** the `Release (production)` workflow in
  [`.github/workflows/migrate.yml`](../.github/workflows/migrate.yml) releases
  only after the `CI / verify` job succeeds for the current `main` SHA.
- **Exact revision:** the release checks out that 40-character SHA, builds it
  with `vercel build --prod`, then deploys only that prebuilt output.
- **Build command:** `bun run env:audit && bun run build` (see `vercel.json`).
  `env:audit` (`scripts/env-audit.ts`) fails the production build when a required
  environment variable is missing, so a misconfigured production deploy fails
  closed at build time rather than booting broken.

### Migrations

Database migrations run before the Vercel deploy in
[`.github/workflows/migrate.yml`](../.github/workflows/migrate.yml):

- **Trigger:** a successful `CI` workflow on `main`, plus a manual fail-closed
  dispatch that requires a full SHA and independently verifies successful CI.
- **What it runs:** `bun run db:migrate`, which applies the Drizzle migrations in
  [`src/lib/db/migrations/`](../src/lib/db/migrations/) tracked by the journal
  `src/lib/db/migrations/meta/_journal.json`.
- **Fail-closed:** a "Validate migration configuration" step exits 1 when the
  `DATABASE_URL_UNPOOLED` secret is absent, so a green run always means the
  migration command was actually attempted against a configured target. This
  closed the earlier migration-secret gap (issue #305) where a missing secret
  produced a misleadingly green run.
- **Connection target:** the direct, non-pooled endpoint (`DATABASE_URL_UNPOOLED`)
  — see [Database connection contract](#database-connection-contract) below for
  the full DSN precedence.

### Authoritative release sequence

The production workflow is deliberately one serial chain:

1. `CI / verify` succeeds for the current `main` SHA;
2. the release gate proves that SHA is still the tip of `main`;
3. production migrations run through the direct connection;
4. the same migration command runs again as a convergence check;
5. the exact checkout is uploaded for a remote Vercel Production build, where
   Sensitive environment variables remain inside Vercel;
6. Vercel promotes that completed build to Production;
7. HTTP smoke runs against the public Production alias at
   `https://murmur.ptoq.io`.

Any failed stage stops later stages. The workflow uses a non-canceling
production concurrency group so two merges cannot overlap migrations or
deployment. A queued stale release also stops before migration because the
requested SHA no longer matches the tip of `main`.

Required GitHub configuration:

| Kind | Name | Purpose |
|------|------|---------|
| Secret | `DATABASE_URL_UNPOOLED` | Direct production migration DSN |
| Secret | `VERCEL_TOKEN` | Vercel CLI authentication |
| Variable | `VERCEL_PROJECT_NAME` | Vercel project; defaults to `murmur` |
| Variable | `VERCEL_SCOPE` | Vercel team/account; defaults to `moapachas-projects` |
| Variable | `VERCEL_NATIVE_PRODUCTION_DISABLED` | Owner acknowledgement that native `main` Production deploy is disabled; release fails closed unless exactly `true` |

Required Vercel cutover: open the Murmur project Git settings and disable
Production deployment for pushes to `main` while retaining Preview deployments.
After verifying the setting, set repository variable
`VERCEL_NATIVE_PRODUCTION_DISABLED=true`. The workflow cannot query the
dashboard setting directly, but it fails closed without this auditable owner
acknowledgement. Leaving native Production enabled still recreates the pre-CI
race even though the Actions release itself is correctly ordered.

Do not reintroduce `vercel pull` followed by a runner-local `vercel build` for
Production. Vercel exports Sensitive variables as redacted placeholders outside
its build environment, so a local prebuild cannot consume production DSNs,
origins, or worker URLs. The canonical `bun run build` still runs `env:audit`;
with a remote build it validates the real values inside Vercel before the
deployment is promoted.

The Vercel deployment URL may be protected by team SSO and is therefore not a
public health target. Exact-SHA identity is established before upload and
attached as deployment metadata; post-deploy HTTP probes use the public alias
that users actually reach. Smoke requests do not follow redirects, so an auth
or error-page redirect cannot be mistaken for a healthy application response.

### Branch protection (issue #308)

`main` is protected by the GitHub ruleset **Protect main**. Changes must arrive
through pull requests and pass the `verify` check before merge.

The enforced policy is:

- require a pull request before merging to `main`;
- require the CI **`verify`** status check (the job in
  [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) to pass;
- require at least one approving review for non-emergency changes;
- block force pushes and branch deletion;
- require conversation resolution before merge;
- do not configure a standing bypass actor.

The current ruleset has no standing bypass, including for administrators. A
true repository recovery requires deliberately editing or disabling the
ruleset, which is itself an auditable owner action. Verify the live rule with:

```bash
gh api repos/p-to-q/murmur/rulesets
```

### Vercel cron constraint (learned empirically)

The Vercel account **rejects sub-daily cron schedules** — a Hobby-tier
restriction. An hourly cron previously broke the Production deploy and had to be
changed to daily. Cron entries in `vercel.json` must therefore stay **daily**
(the billing reconcile/refunds crons run once per day for this reason) unless and
until the project is confirmed on a plan that permits sub-daily crons. Do not add
sub-daily crons on the current plan.

### Object storage for saved audio

New-save audio is written to object storage **only** when the production storage
env is set: `MURMUR_STORAGE_DRIVER=s3-compatible` plus the S3 bucket credentials
and a public URL base (`MURMUR_STORAGE_S3_PUBLIC_URL_BASE`). When those are not
configured, a save falls back to embedding the audio as a data URL. On Vercel
production the env audit **requires** `MURMUR_STORAGE_DRIVER=s3-compatible`, so
the data-URL fallback is a local/dev path, not a production one.

### Required secrets and environment

The authoritative list is enforced by `bun run env:audit`
([`scripts/env-audit.ts`](../scripts/env-audit.ts)) on every production build and
by `collectDatabaseEnvAuditIssues` in
[`src/lib/db/config.ts`](../src/lib/db/config.ts); cross-check against those
rather than trusting this summary to stay complete:

| Purpose | Variables |
|---------|-----------|
| Production release | `DATABASE_URL_UNPOOLED`, `VERCEL_TOKEN`; repository variables `VERCEL_PROJECT_NAME`, `VERCEL_SCOPE` |
| Runtime DB (pooled) | `DATABASE_URL` or `POSTGRES_URL` — must be a Neon pooler host in production |
| Cron routes | `CRON_SECRET` (non-placeholder) |
| Web push notifications | `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` |
| Object storage | `MURMUR_STORAGE_DRIVER=s3-compatible`, `MURMUR_STORAGE_S3_BUCKET`, `MURMUR_STORAGE_S3_REGION`, `MURMUR_STORAGE_S3_ACCESS_KEY_ID`, `MURMUR_STORAGE_S3_SECRET_ACCESS_KEY`, `MURMUR_STORAGE_S3_PUBLIC_URL_BASE` |
| Audio / music workers | `AUDIO_WORKER_URL`, `AUDIO_WORKER_TOKEN`, `RUNPOD_SERVERLESS_ENDPOINT_ID`, `RUNPOD_API_KEY` |
| Payments | `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY` (or `_BASE64`), `WAFFO_TOPUP_PRODUCT_ID`; `ZPAY_PID`/`ZPAY_KEY` (both or neither) |
| Auth | one of `AUTH_URL`/`NEXTAUTH_URL`/`MURMUR_APP_URL`/`VERCEL_URL`; `AUTH_SECRET` when an OAuth provider is configured |

### Rollback and incident ownership

- **Failed deploys do not replace the serving alias:** if the exact-SHA build or
  deploy fails, the workflow stops and the last successful Production
  deployment remains serving. If post-deploy alias smoke fails, treat the
  release as an incident and explicitly promote the last known-good Vercel
  deployment; schema rollback remains a separate decision.
- **Migrations are not auto-rolled-back:** each migration has a `.down.sql`
  pair, but the workflow only rolls forward. Reversing a migration is a manual,
  owner-run operation against the direct endpoint, and it is only safe when no
  already-live code depends on the reverted schema — which is exactly why the
  ordering gap (#307) matters.
- **Ownership:** the production release path — merges to `main`, the migration
  workflow, and any manual migration reversal — is owned by the repository owner
  (Murmur maintainer). Preview deployments are self-service per PR.

## Database connection contract

Production migrations run in
[`.github/workflows/migrate.yml`](../.github/workflows/migrate.yml), which sets
the connection string from the `DATABASE_URL_UNPOOLED` secret (the direct,
non-pooler endpoint) and fails closed when it is absent.

The runtime client, the migration script (`bun run db:migrate`), and Drizzle Kit
all resolve their DSN through one fail-closed helper (`resolveServerDsn` in
[`src/lib/db/config.ts`](../src/lib/db/config.ts)) so there is a single
precedence contract:

- **Runtime (pooled):** `DATABASE_URL` → `POSTGRES_URL`.
- **Migrations (prefer direct):** `DATABASE_URL_UNPOOLED` →
  `POSTGRES_URL_NON_POOLING` → `DATABASE_URL` → `POSTGRES_URL`.

When no DSN is configured the resolver throws a clear error instead of silently
connecting to `localhost`. The localhost default applies only under an explicit
local-dev signal (`NODE_ENV=development` / `test`, or
`MURMUR_DB_ALLOW_LOCAL_FALLBACK=1`), so an operator who follows the documented
contract can no longer migrate the wrong target or hit a misleading localhost
failure. The production env audit (`bun run env:audit`) enforces the same
runtime precedence and rejects direct Neon pooler-less hosts for the runtime URL.

## Known limits right now

The repo now treats `check:links` as a real CI gate because the known broken
references were retired during the branch consolidation work. The remaining
limits are different:

- CodeQL still runs in best-effort mode because plan / entitlement mismatches
  on some private repos can create false red builds unrelated to source
  regressions.
- Vercel's external Git setting must remain configured to skip native Production
  deploys from `main`; GitHub Actions cannot audit that dashboard-only setting.
- Production smoke is deliberately read-only. It proves page and music-health
  contracts, not a paid creation or payment transaction.
- Audio acceptance is automated, but the dataset mix is still bounded by what
  can be checked in or deterministically scaffolded inside CI.
- `next build` is green through the configured webpack command path, and
  `bun run build:audit` currently passes without audited Next.js warnings. The
  audit script still recognizes the older local-storage NFT tracing warning if
  it reappears under a different build mode, but that warning is not present in
  the current build output.

## Human entry points

The repo also ships standard GitHub collaboration surfaces:

- [`.github/pull_request_template.md`](../.github/pull_request_template.md)
- [`.github/ISSUE_TEMPLATE/bug_report.yml`](../.github/ISSUE_TEMPLATE/bug_report.yml)
- [`.github/ISSUE_TEMPLATE/feature_request.yml`](../.github/ISSUE_TEMPLATE/feature_request.yml)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [SECURITY.md](../SECURITY.md)
- [SUPPORT.md](../SUPPORT.md)

The goal is simple: every change, bug, and security concern should have a
default place to land without relying on oral tradition.

## What is intentionally not automated yet

The ordered release and branch protection are implemented. What remains
deliberately outside the release workflow:

- **Vercel native-production cutover:** an owner must keep Production
  auto-deploy disabled in the Vercel dashboard; Preview may remain automatic.
- **Tag-triggered release:** there is no workflow that cuts a GitHub Release on
  `v*` tags yet. Tags, prereleases, and final GitHub Releases are manual
  post-merge operations after the exact `main` SHA passes CI and production
  release smoke (see
  [packaging-and-release.md](./packaging-and-release.md)).

Current automation is strong on validation, hygiene, and schema migration; the
remaining production-release gap is the dashboard-only Vercel native-deploy
cutover, which repository code cannot enforce.

## Optional hardening (not yet adopted)

Common GitHub-Actions add-ons we have considered but deliberately not wired, to
keep the PR gate fast and the workflow set small. Adopt any of them only once the
failure mode it guards against actually starts biting:

- **PR size gate** — warn or fail on diffs above a line threshold to nudge toward
  smaller PRs.
- **Conventional-commit lint** — enforce `type(scope): subject` on PR commits.
- **Bundle-size budget** — fail when `.next/static` grows past a fixed ceiling.
- **Tag-triggered release** — generate a changelog and cut a GitHub Release on
  `v*` tags.
- **CI failure notification** — post to Slack/Discord when a required workflow
  fails on `main`.

None of these is load-bearing today; they are written down here so the option set
is not rediscovered from scratch each time.

## Ongoing maintenance rhythm

Weekly:

- review Dependabot PRs
- merge low-risk GitHub Actions updates
- triage stale issues before auto-close if they still matter
- review the latest `audio-acceptance` artifact and closure report for drift

Per PR:

- ensure the PR template is filled honestly
- verify the smallest useful validation set ran
- check whether docs need an update
- keep heavyweight audio regression work out of the default PR gate unless the
  change actually touches the audio pipeline contract

Per local operator session:

- bring up the web app and audio worker
- run `bun run smoke:local` before assuming the stack itself is healthy
- use `bun run verify:local` when you want the compact local gate, not just
  liveness
- use `bun run qa:report` when you want one machine-readable snapshot covering
  QA health, worker health, and every shared QA route contract
- use `/vibe?demo=1`, `/studio?demo=1`, and `/studio/name?demo=1` when you
  need to inspect or regress mid-journey screens without recreating state by
  hand
- use `/me/debug?debug=1` as the hidden QA cockpit: recent pipeline events plus
  direct links into the mainline and demo-route checkpoints
- use `/api/qa/health` when you want a quick machine-readable snapshot of web +
  worker + QA-route health without reading the full event stream
- when smoke passes but the audio loop still feels wrong, escalate to
  `bun run audit:audio:acceptance` instead of debugging from vibes alone

Per release candidate:

- confirm CI is green on `main`
- review open dependency and CodeQL alerts
- do one manual walkthrough of the critical user path:
  `Hum -> Vibe -> Studio -> Save -> Gallery -> Song detail`

## Future additions

Hosting, branch protection, ordered migrations, exact-SHA deployment, production
smoke, and rollback documentation now exist. The next layer, in rough priority
order:

1. environment drift detection between the documented contract and Vercel's
   configured env
2. uptime and error-budget alerting

These build on deployment reality rather than guesswork; until they land, the
repo should keep optimizing for correctness, reviewability, and fast maintenance.
