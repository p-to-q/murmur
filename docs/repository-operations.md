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
  runs lint, tests, audio-worker tests, and build on PRs and pushes to `main`.
- [`.github/workflows/dependency-review.yml`](../.github/workflows/dependency-review.yml)
  checks incoming dependency risk on PRs.
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

## Known limits right now

The repository still has legacy doc references that point to v2 planning files
or worker paths not present on every split branch. Because of that,
`check:links` is enabled as a scheduled/manual governance check rather than a
hard PR gate for now.

That is intentional, not forgotten:

- keep the checker alive so doc debt stays visible
- avoid blocking unrelated engineering PRs on old documentation drift
- tighten it into a required gate once the remaining broken references are
  retired or replaced

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

Per PR:

- ensure the PR template is filled honestly
- verify the smallest useful validation set ran
- check whether docs need an update

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
