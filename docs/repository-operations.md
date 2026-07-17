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
  TypeScript/Bun tests, audio-worker tests, build audit, and a real local-stack
  smoke against the built app plus a live worker.
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

Production runs on **Vercel's native Git integration** connected to this repo.
There is no separate deploy workflow in `.github/workflows/` — the Git
integration is the deploy path:

- **Preview:** every pull request gets its own Preview deployment.
- **Production:** every push to `main` gets a Production deployment.
- **Build command:** `bun run env:audit && bun run build` (see `vercel.json`).
  `env:audit` (`scripts/env-audit.ts`) fails the production build when a required
  environment variable is missing, so a misconfigured production deploy fails
  closed at build time rather than booting broken.

### Migrations

Database migrations do **not** run as part of the Vercel deploy. They run in
[`.github/workflows/migrate.yml`](../.github/workflows/migrate.yml):

- **Trigger:** every push to `main`, plus manual `workflow_dispatch`.
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

### Known ordering gap (issue #307)

`migrate.yml` and the native Vercel Production deploy **start independently and
in parallel** on each `main` push. There is no ordering between them, so new
application code can go live before the schema it depends on has finished
migrating. This is a real race, documented honestly rather than assumed
harmless: existing migrations create tables, alter columns, delete rows, and add
constraints that runtime code can depend on immediately.

The **recommended target cutover** (workflow support is checked in; activation is
still a deliberate owner/admin action tracked in #307) is:

1. create a Vercel **Deploy Hook** for Production and save it as the repository
   secret `VERCEL_DEPLOY_HOOK_URL`;
2. disable native Production auto-deploy for `main` in the Vercel dashboard, or
   by setting the equivalent Vercel Git deployment setting for the production
   branch;
3. leave **Preview** deployments on the native integration (they carry no
   production schema risk);
4. set the repository variable `VERCEL_DEPLOY_AFTER_MIGRATE=true`.

The checked-in workflow now supports that target state: after `bun run
db:migrate` succeeds, `.github/workflows/migrate.yml` triggers the deploy hook
only when `VERCEL_DEPLOY_AFTER_MIGRATE=true`. Until the owner performs the
Vercel cutover, keep that variable unset/false so this workflow does not create
a second Production deploy on top of the native integration.

### Branch protection (issue #308)

`main` currently has **no ruleset** — direct pushes are possible even though
[WORKFLOW.md](../WORKFLOW.md) says there should be none, and nothing enforces it.
Because every `main` push triggers both the native Production deploy and
`migrate.yml`, an unreviewed direct push reaches production before review or CI
can stop it.

The **required ruleset** (an admin action the owner applies under
**Settings → Rules → Rulesets** in GitHub — it is a repository setting, not
application code) is:

- require a pull request before merging to `main`;
- require the CI **`verify`** status check (the job in
  [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) to pass;
- require at least one approving review for non-emergency changes;
- block force pushes and branch deletion;
- require conversation resolution before merge;
- define a named emergency-bypass owner with an audit expectation for any bypass.

This is tracked in #308.

Owner checklist:

1. In GitHub, open **Settings -> Rules -> Rulesets** and create an active
   branch ruleset targeting exactly `main`.
2. Enable pull-request requirement, one approval, conversation resolution,
   required status check `verify`, no force pushes, and no branch deletion.
3. If emergency bypass is allowed, restrict it to a named owner/team and require
   a follow-up PR or incident note that records the bypass reason.
4. Confirm the rule with `gh api repos/:owner/:repo/rulesets` or the GitHub UI.

This cannot be fully enforced by repository files alone. A checked-in workflow
can detect damage after a push, but only a GitHub ruleset can prevent the
unreviewed `main` write that would also trigger Production deploy and
production migrations.

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
| Production migrations (direct/unpooled) | `DATABASE_URL_UNPOOLED` (repo secret for `migrate.yml`; `POSTGRES_URL_NON_POOLING` also accepted) |
| Runtime DB (pooled) | `DATABASE_URL` or `POSTGRES_URL` — must be a Neon pooler host in production |
| Cron routes | `CRON_SECRET` (non-placeholder) |
| Web push notifications | `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` |
| Object storage | `MURMUR_STORAGE_DRIVER=s3-compatible`, `MURMUR_STORAGE_S3_BUCKET`, `MURMUR_STORAGE_S3_REGION`, `MURMUR_STORAGE_S3_ACCESS_KEY_ID`, `MURMUR_STORAGE_S3_SECRET_ACCESS_KEY`, `MURMUR_STORAGE_S3_PUBLIC_URL_BASE` |
| Audio / music workers | `AUDIO_WORKER_URL`, `AUDIO_WORKER_TOKEN`, `RUNPOD_SERVERLESS_ENDPOINT_ID`, `RUNPOD_API_KEY` |
| Payments | `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY` (or `_BASE64`), `WAFFO_TOPUP_PRODUCT_ID`; `ZPAY_PID`/`ZPAY_KEY` (both or neither) |
| Auth | one of `AUTH_URL`/`NEXTAUTH_URL`/`MURMUR_APP_URL`/`VERCEL_URL`; `AUTH_SECRET` when an OAuth provider is configured |

### Rollback and incident ownership

- **Deploy rollback is automatic-ish:** if a new Vercel deploy fails to build or
  boot, Vercel keeps the last successful deployment serving. A failed deploy does
  not take production down.
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
- Production deploy (Vercel native Git integration) and the migration workflow
  still start in parallel on each `main` push, so there is an unresolved
  migrate-before-deploy ordering race (issue #307); see
  [Production topology and deployment](#production-topology-and-deployment).
- `main` has no branch-protection ruleset yet, so direct pushes remain possible
  (issue #308).
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

The deploy path is settled (Vercel native Git integration). What remains
deliberately un-automated is governance that requires an owner/admin decision, not
a hosting choice:

- **Ordered migrate-then-deploy** (issue #307): production migrations and the
  native deploy still race. The recommended Deploy-Hook cutover is documented in
  [Production topology and deployment](#production-topology-and-deployment) but
  intentionally not implemented in code, because disabling native production
  auto-deploy is an owner action.
- **Branch protection on `main`** (issue #308): the required ruleset is a GitHub
  repository setting the owner applies; it cannot be committed as application
  code.
- **Tag-triggered release**: there is no workflow that cuts a GitHub Release on
  `v*` tags yet; tagging is a manual post-merge step (see
  [packaging-and-release.md](./packaging-and-release.md)).

Current automation is strong on validation, hygiene, and schema migration; the
gap is ordering and enforcement, not delivery target.

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

Hosting is chosen (Vercel) and preview deployments, a production migration
workflow, and this rollback/runbook documentation already exist. The next layer,
in rough priority order:

1. the ordered migrate-then-deploy cutover (issue #307)
2. the `main` branch-protection ruleset (issue #308)
3. environment drift detection between the documented contract and Vercel's
   configured env
4. uptime and error-budget alerting

These build on deployment reality rather than guesswork; until they land, the
repo should keep optimizing for correctness, reviewability, and fast maintenance.
