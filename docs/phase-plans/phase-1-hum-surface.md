# Phase 1 Plan — Hum Surface Truth

Date: 2026-06-03

This is **Phase 1, Stop A**. Phase 1 in `docs/execution-roadmap.md` lists eight
stops; the audio worker, billing gate, and route boundary are already
shipped (see the diff against the planning baseline). What is missing is
the **client-side honesty layer** that lets the existing differentiated
server errors actually reach a user, plus the minimum tests to keep the
new boundary from regressing.

## User / System Problem

`/api/transcribe` now emits five distinct typed error codes
(`insufficient_notes`, `no_voiced_frames`, `worker_http_error`,
`audio_too_large`, `audio_required` / `validation_error`, `server_error`),
but the HumScreen flattens every failure to a single `"inaudible"` toast.
That breaks `docs/page-contracts.md` §1: the user can no longer tell why
their recording failed, and the "音频结果不对 → 60 秒可调试" goal cannot
hold if even the user-facing surface conflates billing, format, and
recording problems.

The same route also lacks any integration-level test even though it owns
billing debits and the new server-authoritative audio boundary.
`docs/api-conventions.md` §15 requires at least one happy-path plus one
error-path test per route.

## Real Constraints

- Cannot touch HumScreen visuals beyond what the contract requires; the
  blob/aurora/orb stays exactly as-is.
- Cannot pull a new runtime dependency (no SWR yet — would be a
  Phase-1-wide decision; keep this stop self-contained).
- Cannot introduce server-side state for the balance hook; the route
  already exists and is the source of truth.
- The local-dev demo path (`x-murmur-user-id: local-demo-user`) must keep
  working through this PR; Phase 3 is the place to remove it.

## Stable Behavior

- Pressing-and-holding the orb still records, still calls
  `/api/transcribe`, still ends in the vibe selection cards on success.
- The "示例旋律 / Try demo" button still bypasses the server and runs the
  local fixture.
- Mic-permission denial still shows the existing copy.
- Existing saved songs are untouched.

## Stops / PRs

1. **`useUserBalance()` hook + balance pill on Hum (idle).**
   New file `src/lib/hooks/use-user-balance.ts`; SWR-style cache that
   reads `GET /api/user/balance`, exposes `{ notes, planTier, nextRefillAt,
   refresh }`, and stays cheap on tab focus. HumScreen reads it and
   shows a tiny "1 Note" pill near the CTA when idle. No layout shift.
   No top-up button yet — that arrives with the `/topup` route in Phase 4.

2. **Typed transcribe error from the client transport.**
   `src/lib/api/transcribe.ts` already wraps `/api/transcribe` but
   throws a string. Promote it to throw a typed `TranscribeRequestError`
   carrying `code`, `message`, `requestId`, and an optional
   `currentBalance` for 402. Stainer facade re-throws cleanly.

3. **HumScreen differentiated error surface.**
   Replace the single `"mic" | "inaudible"` enum with the contract's
   `TranscribeErrorCode`. New `useTranscribeError()` map renders distinct
   copy per code (no_voiced_frames / too_short / insufficient_notes /
   rate_limited / worker_unavailable / server_error). Each error path
   emits a `memory.reportAction` event matching the contract
   (`{ type: "hum_error", code }`).

4. **Route-level test for `/api/transcribe`.**
   New `src/app/api/transcribe/route.test.ts`. Covers: missing audio
   (400), too-large audio (413), invalid instrument (400), insufficient
   balance (402 with body), worker no_voiced_frames (422), worker
   http_error (502), and the happy path. Mocks `resolveRequestAuth`,
   `getNotesBalance`, `spendNotes`, and `transcribeWithAudioWorker`.

5. **Dictionary + contract bookkeeping.**
   New i18n keys for each error code; tiny copy pass that matches
   Murmur's calm tone. Page-contract Hum §1 Done items get the matching
   ✅ in this plan file at completion.

## Validation

- `bun test` (existing 15 plus the new hook test, error map test, and
  route tests).
- `bun run lint`.
- `bun run build`.
- Manual: `bun dev` + curl `/`, `/me`, `/gallery`, `/studio` to confirm
  the dev-server stability fix from Phase 0 still holds after the new
  hook + dict imports.

## Out of Scope

- Top-up CTA wiring (lives with `/topup` in Phase 4).
- Replacing the HumScreen aurora / orb visuals.
- A dev-only diagnostics overlay; that is Phase 1 Stop B, deliberately
  separated so this PR stays small.
- Migrating `resolveRequestAuth` off the header path; Phase 3 owns auth.
- SWR or react-query introduction.

## Done Checklist

- [x] `useUserBalance()` exists and is consumed by HumScreen.
- [x] `transcribeRecording` throws a typed `TranscribeRequestError`.
- [x] HumScreen surfaces five distinct error states with matching copy
      and `memory.reportAction` events.
- [x] `/api/transcribe` has at least one happy-path test and one test
      per documented error code.
- [x] `bun test`, `bun run lint`, `bun run build` all green.
- [x] Dev server (webpack mode) still serves `/`, `/me`, `/gallery`,
      `/studio` with 200.

## Shipped — Stop A (Hum Truth)

- `src/lib/hooks/use-user-balance.ts` — SWR-style hook with a shared
  in-flight cache and a `__resetUserBalanceCacheForTesting` escape
  hatch.
- `src/lib/api/transcribe.ts` — `TranscribeRequestError` carrying
  typed `code`, HTTP `status`, `requestId`, and `currentBalance` for
  402s; explicit mapping from server error strings to client codes.
- `src/components/screens/HumScreen.tsx` — six-variant error state
  (`mic | inaudible | too_short | insufficient | rate_limited |
  unavailable`), tiny tabular-nums balance pill on the idle CTA row
  (turns warm-orange at 0 notes), explicit `memory.reportAction`
  event on every failure, and a short request-id ref on the error
  card for incident triage.
- `src/lib/i18n/dict.ts` — 14 new keys covering the four new error
  surfaces plus balance label/empty/per-take copy in both languages.
- `src/app/api/transcribe/route.test.ts` — nine cases covering
  happy path, missing audio, oversize audio, non-melody instrument,
  insufficient balance, worker `no_voiced_frames`, worker HTTP
  errors, ledger spend failure, and a 401 envelope from the auth
  resolver.
- `src/lib/api/transcribe.test.ts` — five cases covering the
  typed-error mapping including the silent `network_error` fall-back.
- `src/lib/hooks/use-user-balance.test.ts` — four cases covering
  happy path, 401, 503, and concurrent in-flight de-duplication.

## Shipped — Stop B (Pipeline Debug Surface)

This stop was originally split out, then promoted into the same PR
because the typed-error work and the diagnostic surface answer the
same question ("did this transcribe go right?"). The buffer is the
floor of `docs/observability.md` §8 — a server-side singleton ring
buffer captured by the typed `log()` helper.

- `src/lib/observability/recent-events.ts` — 32-entry ring buffer
  backed by `globalThis` so Next.js dev's per-route module instances
  share one writer; tracks the audio-pipeline events only; redacts
  any `raw*` / `audio*` keys and clamps oversize strings + array
  payloads before storing.
- `src/lib/observability/log.ts` — every `log()` call now also
  publishes into the ring buffer; transparent to existing callers.
- `src/app/api/observability/recent-events/route.ts` — GET endpoint
  gated by `NODE_ENV !== "production"` or the explicit
  `MURMUR_ENABLE_DEBUG_SURFACE=true` flag.
- `src/app/me/debug/page.tsx` — pull-driven debug page, 2 s polling,
  pause / filter / copy-JSON affordances, level-coded entries, request
  ids surfaced for cross-referencing the dashboards described in
  `docs/observability.md` §6.
- `src/lib/observability/recent-events.test.ts` — five cases including
  the redaction + large-array summarisation guarantees.

## Validation Evidence

- `bun test` → 39 pass, 0 fail (was 15 before Phase 1).
- `bun run lint` → clean (0 errors, 0 warnings).
- `bun run build` → green; new routes registered:
  `/api/observability/recent-events`, `/me/debug`.
- `bun dev` (webpack) → `/`, `/me`, `/gallery`, `/studio`, `/me/debug`
  all return 200 within 2.6 s on cold start. `POST /api/transcribe`
  with an empty body produces a 500 + `transcribe.failed` entry in
  the ring buffer, visible at `/api/observability/recent-events`
  within milliseconds. The `useUserBalance()` 503 fallback path stays
  graceful when Postgres is offline (the pill hides instead of
  rendering `0`).

## Reflection

- The page-contract was a sharper spec than the code suggested. The
  route already emitted the typed error codes; the HumScreen flatten
  pattern was hiding a contract gap, not a missing feature. Reading
  the contract was the cheapest path to finding the right diff.
- Next.js dev's per-route module isolation forced the ring buffer
  onto `globalThis`. The fix is small but worth a comment because
  the next person to add server-side singleton state will hit the
  same wall. Production single-instance behaviour matches dev with
  the same shim.
- The `react-hooks/set-state-in-effect` rule is strict enough that
  polling UIs need the `setTimeout(tick, 0)` indirection or an
  `eslint-disable`. The indirection is cheap and keeps the lint bar
  honest; future polling code should follow the same pattern.
- The 402 path is the only error that already has a structured body
  payload (`currentBalance`, `cost`). When the `/topup` route lands
  in Phase 4, the HumScreen error card can lift those fields into a
  visible "you have 0 — top up" CTA without further server changes.

## Notes For The Next Stop

- **Stop C — Worker `/replay`.** Audio-engine worker should retain
  short-lived sample copies for 422 results and expose `POST /replay`
  per `docs/observability.md` §8. Most of the python plumbing exists;
  the missing piece is sample storage + the route. Likely two-file
  Python PR.
- **Stop D — `arrangement.generated` enrichment.** The current event
  carries melody-carrier ids and vibes. Adding `seed` and
  `clampedNoteCount` here would close the determinism loop and let
  golden-master diffs cite the actual seed that produced them.
- **Stop E — `/me/debug` from `/me`.** Page-contracts §7 wants a
  `?debug=1` link from the default Me page; held out of this PR to
  keep the Me surface untouched. One-liner addition once we are
  ready to expose it to power users.
