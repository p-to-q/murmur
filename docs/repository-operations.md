# Repository Operations

This document describes the operational governance that keeps Murmur reviewable,
maintainable, and safe to iterate on.

For the short, current-state product-engineering assessment, also see
[docs/closure-audit.md](./closure-audit.md).

## Out of scope

This document does not choose a deployment vendor or define product roadmap
priority. It covers repository hygiene, review entry points, and automation.

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
- There is still no deployment workflow because hosting is intentionally not
  locked yet.
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

We are not adding deployment automation until the deploy path is chosen.
`packaging-and-release.md` keeps that decision open between:

- Vercel Pro
- prebuilt Vercel deploy
- self-hosted/container deploy

That means current automation is strong on validation and hygiene, but neutral
on delivery target.

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

## Future additions once hosting is chosen

The next layer should depend on deployment reality, not guesswork:

1. preview deployment checks
2. production deployment workflow
3. rollback/runbook documentation
4. environment drift detection
5. uptime and error-budget alerting

Until then, the repo should optimize for correctness, reviewability, and fast
maintenance rather than pretend CD is settled.
