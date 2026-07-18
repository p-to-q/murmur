# Product Engineering System

Status: canonical decision framework<br>
Owner: product engineering<br>
Last verified: 2026-07-18

This document defines how Murmur chooses product and architecture changes. It
does not claim that every target below is implemented. Current runtime truth
lives in code, schema, configuration, tests, and `architecture.md`; measured
results outrank estimates.

## Product invariant

A user should be able to turn one hum into a recoverable song without losing
work, paying twice, waiting for unrelated work, or needing to understand the
system's internals.

The fastest meaningful value is the first playable take that preserves the
user's melodic intent. Three completed alternatives, Studio edits, Gallery,
export, and sharing are later value and must not delay that first listen.

## Atomic rules

1. A recording gesture receives visible feedback within 100 ms, excluding the
   browser's permission prompt. Capture is local and is not gated on network or
   worker health.
2. Retries reuse stable operation identities. User work and paid effects must
   not be lost or duplicated after a timeout, refresh, or ambiguous response.
3. Only correctness-critical work blocks progress. Billing settlement, the
   selected artifact, and the durable song write are blocking; analytics,
   notifications, and unselected takes are not.
4. Results appear progressively. The first ready take is playable and
   selectable while sibling takes continue independently.
5. Concurrency follows the narrowest resource. Parallel browser requests do not
   improve throughput when a worker has one execution lane; they increase queue
   time, retry amplification, and cost.
6. Every wait has an owner, a deadline, a recoverable state, and honest user
   feedback. Caller cancellation is not reported as a timeout.

## User-perceived budgets

These are initial product targets, not measured claims. Instrument and tune them
with real P50/P95 data.

| Milestone | Initial target |
| --- | ---: |
| Record press to capture feedback | <= 100 ms |
| Stop to final transcription | P50 <= 8 s; P95 <= 20 s |
| Stop to first playable take | P50 <= 40 s; P95 <= 90 s |
| Ready take to Pick response | <= 100 ms |
| Pick to locally recoverable draft | <= 300 ms |
| Save request to durable song id | P50 <= 1 s; P95 <= 3 s |
| Gallery data ready | cached <= 500 ms; network P95 <= 2 s |
| Share creation and copy | P50 <= 500 ms; P95 <= 2 s |

The current component budgets remain in
`src/lib/observability/latency-budgets.ts`. A budget is useful only when its
breach emits a queryable event and a durable metrics sink can aggregate it.

## Runtime shape

The current shape is intentionally a modular monolith:

```text
Browser capture and recovery
  -> Next.js API control plane
  -> platform adapters
  -> Postgres / object storage / audio worker / music worker
```

Keep domain logic in `src/modules/`, external runtimes in
`src/lib/platform/`, client transport in `src/lib/api/`, and persistence in
`src/lib/db/`. Do not introduce a second state system, generic event bus, or
service split without a measured ownership or reliability problem.

### Long-running paid work

Music generation now has the characteristics of a durable job: it can exceed
30 seconds, has a paid side effect, should survive page exit, and needs
query/recovery semantics. Its target state machine is:

```text
accepted -> queued -> running -> succeeded | failed | canceled | expired
```

The job record must bind `user_id`, `operation_id`, `request_hash`, provider job
id, attempt, lease, output key/digest, error class, and timestamps. Creating the
ledger debit, job, and outbox event belongs in one transaction. A dispatcher
may initially lease Postgres rows; Kafka or a general workflow engine is not a
prerequisite. SSE is a replaceable status transport, not the source of truth.

Transcription remains synchronous while its queue wait and P95 stay inside the
current budget. The worker must expose bounded capacity and return
`Retry-After` instead of accepting unbounded work that continues after the web
request has timed out.

## Cache and delivery rules

- Cache immutable, content-addressed audio and artwork aggressively.
- Deduplicate concurrent reads and use a short private TTL for user-owned list
  and detail data; never put private responses in a shared cache.
- Do not cache authentication, billing decisions, ledger balances, or mutation
  results.
- Use a static route shell and streaming/loading boundaries where they improve
  first feedback. Keep recording and local-draft surfaces client-owned.
- Workers should upload large results directly to object storage. Control-plane
  responses carry identifiers, digests, and signed delivery URLs rather than
  repeatedly proxying large WAV payloads.

## Evidence and release gates

Production quality is demonstrated by evidence, not document checkboxes:

- one deterministic browser golden path from Hum through public playback;
- retry, timeout, insufficient-balance, and worker-outage journeys;
- exact-SHA CI success before migration and production deployment;
- expand/migrate, verify, deploy, and post-deploy smoke in one ordered release
  chain;
- durable latency/error/job metrics correlated by operation, request, provider
  job, storage object, and release SHA;
- branch protection, an explicit emergency bypass owner, and an incident note
  for every bypass.

## Evolution roadmap

### Now

- Protect `main` and order CI, migration, deployment, and production smoke.
- Add the browser golden path and repair the scheduled audio acceptance job.
- Make current observability claims honest and connect budget events to a
  durable sink.

### Validate next

- Measure first-playable latency, save latency, duplicate compute, page-exit
  loss, worker queue wait, and orphaned storage objects.
- Test a journey where the chosen take can go directly to naming/save and
  Studio is an optional path. Promote it only if comprehension and completion
  improve without harming creative control.
- Split canonical song persistence from audio rendering so the artifact can be
  secured before a slow encode/upload, with explicit processing state.

### Adopt when evidence warrants it

- Durable music jobs and transactional notification outbox.
- A narrow playback-session coordinator if cross-page audio ownership bugs are
  observed.
- Focused extraction of capture/submission hooks from `HumScreen` after golden
  path coverage exists.

### Avoid for now

- SSE without durable job state, a generic workflow platform, a broad
  microservice split, global query-cache migration, or a wholesale UI/store
  rewrite. Each adds coordination cost without fixing the current bottleneck by
  itself.

## Research basis

This framework follows primary guidance on [Next.js caching and streaming](https://nextjs.org/docs/app/getting-started/caching),
[Next.js navigation feedback](https://nextjs.org/docs/app/getting-started/linking-and-navigating),
[OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/),
[Google SRE service-level objectives](https://sre.google/sre-book/service-level-objectives/),
[PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html),
and [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
