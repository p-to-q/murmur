# Durable Music Jobs

Status: current phase-one contract<br>
Owner: product engineering<br>
Last verified: 2026-07-18

Paid music generation uses `music_jobs` as its recoverable source of truth.
This boundary exists alongside the legacy synchronous `/api/music/generate`
route. The browser adapter is implemented but remains off by default until a
measured Preview/canary cutover proves the new path in production conditions.

## API contract

- `POST /api/music/jobs` accepts the same multipart music input plus a required
  stable `operationId` (or `Idempotency-Key`). It returns `202`, a `jobId`, and
  status/audio URLs.
- Exact replays return the existing job and never charge or submit twice.
- Reusing an operation id with different canonical input returns `409
  idempotency_conflict`.
- `GET /api/music/jobs/:jobId` returns only the owner's job and opportunistically
  resumes an expired lease against the already recorded provider job id.
- `DELETE /api/music/jobs/:jobId` records `canceled` before submission or
  `cancel_requested` after submission. Cancellation and refund are idempotent.
- `GET /api/music/jobs/:jobId/audio` serves a successful private artifact to
  the authenticated owner.

## State machine

```text
accepted -> running -> queued <-> running -> result_ready -> succeeded
    |          |          |          |             |
    +----------+----------+----------+------------> failed / expired
    +----------+----------+-----------------------> canceled
               +----------------------------------> submission_unknown
                          +-----------------------> cancel_requested -> canceled
```

The database stores the operation id, canonical request hash, provider job id,
attempt, lease, paid ledger id, terminal output key, and classified error. A
network failure while submitting is terminalized as `submission_unknown` and
refunded; without a provider job id Murmur never automatically submits a second
GPU job. The spend and initial job row share one transaction. Successful
delivery uses the existing operation settlement ledger; failed and canceled
jobs use the existing idempotent refund/pending-refund path. A recorded
`result_ready` output is never recomputed merely because settlement needs
another attempt.

Before `result_ready`, the RunPod handler generates up to two candidates and
applies the versioned `music-technical-v1` signal-level Gate. It returns hashed
input receipts and candidate diagnostics. The Web runner independently verifies
the receipt and WAV; only then does it store and settle the artifact. See
[music-quality-operations.md](runbooks/music-quality-operations.md).
During rolling deployment, the Web WAV Gate stays active while missing legacy
Worker receipts are observed but tolerated. The deployment script enables
strict evidence only after a versioned warm-up proves the new Worker protocol.

## Phase-one limit

The runner is triggered after the creation response and by later GET/DELETE
requests. Each advance does at most one provider status read and stays inside a
short request budget. A DB lease prevents concurrent progression and is
released after a non-terminal status read so the next client poll can continue
without an artificial lease delay. Provider
identity survives a dead request, so recovery never requires another provider
submit. `result_ready` persists private, content-addressed audio without a TTL
before billing settlement; a later advance can replay settlement without
rerunning the model or refunding delivered work.

This is durable state, but it is not yet a continuously scheduled queue. During
phase one the client must poll GET while it wants progress. A dispatcher or cron
that leases accepted/expired jobs independently of browser traffic is required
before claiming guaranteed completion while every client is away.

## Migration rule

Keep `/api/music/generate` until the Vibe client has shipped against jobs and a
production metric confirms no legacy calls. Migration must preserve stable
clip operation ids and first-ready progressive presentation.

The browser compatibility switch is
`NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS=1`. It is off by default. In a Preview
with migration `0027` applied, the existing first-ready flow creates and polls
one durable job per clip; sibling clips may still be in flight concurrently,
and abort sends a best-effort cancellation. Do not enable it in Production
until the schema is deployed, the golden path passes against the real route,
and job terminal, latency, duplicate-operation, settlement, and refund metrics
are visible. Keep the synchronous route available during canary rollback.
