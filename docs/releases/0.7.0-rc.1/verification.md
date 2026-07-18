# 0.7.0-rc.1 Verification

Prepared version: `0.7.0-rc.1`

Build: `409`

Candidate date: 2026-07-18

## Repository evidence

- lint, application TypeScript, and test TypeScript pass;
- local Markdown links and workflow YAML parse pass;
- Bun unit/integration coverage runs with no test failures;
- the production webpack build passes;
- the Chromium golden path passes against the durable music-job client;
- read-only smoke passes for `/`, `/gallery`, and `/api/music/health` on the
  current production alias.

The authoritative evidence for publication is the green GitHub `verify` check
on the final `main` SHA. Local evidence does not replace that gate.

## Required release sequence

1. Merge the reviewed candidate with `verify` green.
2. Confirm Vercel native Production deployment from `main` is disabled while
   Preview remains enabled, then set repository variable
   `VERCEL_NATIVE_PRODUCTION_DISABLED=true`.
3. Let `Release (production)` run migration `0027`, convergence verification,
   exact-SHA deployment, then immutable and alias smoke.
4. Create tag `v0.7.0-rc.1` on that exact merged SHA.
5. Publish a GitHub pre-release from the tag using `release-notes.md`.

## Rollback

- Keep `NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS` off for broad Production traffic
  until the canary metrics are accepted.
- Application rollback promotes the last known-good Vercel deployment.
- Migration `0027` is additive. Do not run its down migration while any durable
  jobs must be retained or while a deployed client can still call the job API.
