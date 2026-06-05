# Repository Operations

This document describes the operational governance that keeps Murmur reviewable,
maintainable, and safe to iterate on.

## Out of scope

This document does not choose a deployment vendor or define product roadmap
priority. It covers repository hygiene, review entry points, and automation.

## Baseline automation

Murmur now uses standard GitHub-native governance surfaces instead of ad hoc
repo rituals:

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
  runs the fast required gate on PRs and pushes to `main`: lint, link checks,
  TypeScript/Bun tests, audio-worker smoke tests, and build.
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

The split between `ci.yml` and `audio-acceptance.yml` is intentional:

- PR feedback should stay fast enough to use continuously.
- Full audio closure and report generation should still happen regularly, but
  without making every UI or docs change wait on the heaviest suite.
- The repo no longer pretends the deleted `basic-pitch-service` worker is a
  supported fallback path; verification now targets `workers/audio-engine`
  directly so stale infrastructure cannot silently mask breakage.

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
