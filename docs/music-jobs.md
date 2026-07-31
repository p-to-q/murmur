# Durable Music Jobs

Status: current phase-one contract<br>
Owner: product engineering<br>
Last verified: 2026-07-30

Paid music generation uses `music_jobs` as its recoverable source of truth.
The polling browser adapter remains off by default until Preview/canary proves
it, while stable-clip serverless calls to the synchronous
`/api/music/generate` compatibility route already reuse this same receipt and
return its settled object-store artifact as a WAV response.

## API contract

- `POST /api/music/jobs` accepts the same multipart music input plus a required
  stable `operationId` (or `Idempotency-Key`). It returns `202`, a `jobId`, and
  status/audio URLs.
- Exact replays return the existing job and never charge or submit twice.
- Reusing an operation id with different canonical input returns `409
  idempotency_conflict`.
- `GET /api/music/jobs/:jobId` returns only the owner's job and opportunistically
  advances the already recorded provider job id for lower
  interactive latency.
- `DELETE /api/music/jobs/:jobId` records `canceled` before submission or
  `cancel_requested` after submission. Cancellation and refund are idempotent.
- `GET /api/music/jobs/:jobId/audio` serves a successful private artifact to
  the authenticated owner.

## State machine

```text
accepted -> submitting -> queued <-> running -> result_ready -> succeeded
    |            |           |          |             |
    +------------+-----------+----------+------------> failed / expired
    +------------+-----------+-----------------------> canceled
                 +-----------------------------------> submission_unknown
                             +-----------------------> cancel_requested -> canceled
```

The database stores the operation id, canonical request hash, provider job id,
lease fencing epoch, deadline, next-run time, paid ledger id, terminal output
key, and classified error. A
network failure while submitting is terminalized as `submission_unknown` and
refunded; without a provider job id Murmur never automatically submits a second
GPU job. The spend and initial job row share one transaction. Successful
delivery uses the existing operation settlement ledger; failed and canceled
jobs atomically persist their terminal state and pending-refund intent before
an immediate idempotent refund is attempted. A recorded
`result_ready` output is never recomputed merely because settlement needs
another attempt.

Before `result_ready`, the RunPod handler generates up to two candidates and
applies the versioned `music-technical-v2` signal-level Gate. It returns hashed
input receipts plus bounded candidate, conditioning, sampling, runtime, and
normalization diagnostics. Requested hum/melody conditioning must be proven as
applied. The Web runner independently verifies the receipt, final candidate
digest, conditioning evidence, and WAV; only then does it store and settle the artifact. See
[music-quality-operations.md](runbooks/music-quality-operations.md).
During rolling deployment, the Worker exposes v1 compatibility and complete v2
envelopes together. New Web prefers v2, old Web can still consume v1, and the
Web WAV Gate always remains active. The deployment script enables the separate
v2 requirement only after a SHA-specific endpoint passes full warm-up.

## Dispatch and recovery

The runner is triggered after the creation response and by later GET/DELETE
requests. The protected `GET /api/music/cron/jobs` endpoint exposes the same
bounded dispatcher to deployment infrastructure. Each advance
does at most one provider status read and stays inside a short request budget.
A DB lease and monotonically increasing fencing epoch prevent concurrent or
stale progression. Non-terminal reads set `next_run_at`; browser polling can
still reduce visible latency. Provider
identity survives a dead request, so recovery never requires another provider
submit. `result_ready` persists private, content-addressed audio without a TTL
before billing settlement; a later advance can replay settlement without
rerunning the model or refunding delivered work.

Every job has a 15-minute application deadline in addition to the provider TTL.
A RunPod `404` gets a short propagation grace period and then expires instead
of remaining active forever. If submission may have reached RunPod but no job
id can be persisted, Murmur records `submission_unknown` and never submits the
same paid operation again automatically.

This is a database-backed dispatcher contract, not a high-throughput queue.
The repository does not schedule it in `vercel.json`: Vercel Hobby only permits
daily cron, which is too slow for this workflow, while minute cadence requires
Pro or another production scheduler. Keep the durable feature switch off until
migration `0028`, a scheduler with at least minute cadence, cron authentication,
terminal/refund metrics, and a real provider canary are verified in Preview.

## Migration rule

Keep `/api/music/generate` until the Vibe client has shipped against jobs and a
production metric confirms no legacy calls. Stable serverless clip ids are
already hash-bound to durable jobs at that route; malformed/missing ids and the
local HTTP Worker retain the direct compatibility path. In production, stable
clips selected to HTTP fail before billing until that transport implements the
same durable receipt and replay contract. Migration must preserve stable clip
operation ids and first-ready progressive presentation.

The browser compatibility switch is
`NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS=1`. It is off by default. In a Preview
with migration `0027` applied, the existing first-ready flow creates and polls
one durable job per clip; sibling clips may still be in flight concurrently,
and abort sends a best-effort cancellation. Do not enable it in Production
until the schema is deployed, the golden path passes against the real route,
and job terminal, latency, duplicate-operation, settlement, and refund metrics
are visible. Keep the synchronous route available during canary rollback.
