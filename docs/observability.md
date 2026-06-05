# Observability

Murmur today logs `console.error` on failure and nothing on success.
That is the wrong baseline for a product whose biggest risk used to be
silent fixture substitution, and whose current behavior still includes a
very narrow auto-rescue path for transient hum failures. v2's
observability target: **when the user says "音频结果不对," we can find
out within 60 seconds what went wrong, for which user, in which region,
with which provider chain, and against what code revision**.

This document specifies what we log, how we structure it, what we trace,
what we surface to dashboards, and where the budgets land.

It does **not** specify a vendor lock-in; it specifies the shape, then
suggests vendors per region.

---

## 1. Pillars

Three pillars, named with the v2 names Codex should use everywhere:

- **Logs** — structured JSON lines, one event per significant action,
  always tied to a `requestId` and a `userId`.
- **Metrics** — counters / gauges / histograms, in OpenTelemetry shape,
  exported to Prometheus-compatible storage.
- **Traces** — OpenTelemetry spans across the request boundary; the
  audio worker participates as a downstream span.

Plus the product-level pillar Murmur already has:

- **Audit events** — the `memory.reportAction` adapter (see
  `user-model.md` §10). Not the same as logs; product-level user
  intent, not engineering observability.

These four cover the bases. We do not add a fifth.

---

## 2. Log envelope

Every log line, every shell, every worker, JSON-encoded, one per line:

```json
{
  "ts":        "2026-06-03T01:23:45.678Z",
  "level":     "info" | "warn" | "error",
  "msg":       "song.created",
  "service":   "web" | "audio-engine" | "miniprogram-server",
  "region":    "intl" | "cn",
  "release":   "git_sha or semver",
  "requestId": "req_…",
  "userId":    "usr_…" | null,
  "sessionId": "ses_…" | null,
  "shell":     "web" | "ios" | "android" | "wechat_mp" | "server",
  "route":     "/api/songs",
  "durationMs": 142,
  "ext":       { ...domain-specific fields... }
}
```

Codex defines a typed helper in
`apps/web/src/lib/observability/log.ts`:

```ts
type LogEvent = "song.created" | "song.deleted" | "transcribe.failed" | ... ;

function log(event: LogEvent, ext: Record<string, unknown>, opts?: { level?: "info" | "warn" | "error" }): void;
```

Routes call `log("song.created", { id, vibe, bpm })` after success.
Errors call `log("song.create_failed", { error_code }, { level: "error" })`.

Free-form `console.log` is **deprecated** in v2; the lint warns on it.

### What we log

| Event | When | Critical fields |
|---|---|---|
| `auth.session_issued` | login success | `provider`, `shell` |
| `auth.session_revoked` | logout / delete | `reason` |
| `auth.me_failed` | account snapshot failed | `error` |
| `auth.logout_failed` | session revoke failed | `error` |
| `transcribe.requested` | request received | `format`, `bytes`, `targetInstrument` |
| `transcribe.completed` | 200 emitted | `provider`, `noteCount`, `denoiseMs`, `pitchMs`, `polishMs`, `snr`, `voicedRatio` |
| `transcribe.failed` | 4xx/5xx emitted | `error_code`, `phase` |
| `arrangement.generated` | new vibe versions | `melodyId`, `seed` |
| `studio.edit_token_applied` | applyEdit run | `tokens`, `via: "rule" | "llm" | "scene"` |
| `song.created` | save success | `songId`, `vibe`, `bpm`, `duration` |
| `notes.spent` | ledger debit | `reason`, `cost`, `balanceAfter` |
| `notes.granted` | ledger credit | `reason`, `delta`, `balanceAfter` |
| `purchase.succeeded` | webhook | `provider`, `sku`, `amountCents`, `currency` |
| `purchase.refunded` | webhook | same |
| `webhook.duplicate` | repeat event id | `provider`, `providerEventId` |
| `rate_limit.tripped` | 429 | `route`, `bucket` |

Codex builds this list as the canonical taxonomy. Adding events is
permitted; modifying field names later is not.

### Sampling

- `info` events go through 1:1 in dev, 1:10 in prod for routes hit
  >100 RPS, 1:1 otherwise.
- `warn` + `error` are never sampled.
- The `transcribe.completed` event is **never sampled** — it's the
  primary debugging surface for the audio pipeline complaint.

---

## 3. Metrics

OpenTelemetry SDK in Next.js + the Python worker. Export to:

- intl: Grafana Cloud Prometheus (or Vercel-bundled OTel collector
  forwarding).
- cn: 腾讯云监控 (CMQ-compatible Prometheus endpoint).

### What we track

Counters:

```
murmur_transcribe_requests_total{provider, status, region}
murmur_transcribe_failures_total{error_code, region}
murmur_song_saves_total{region, vibe}
murmur_notes_spent_total{reason, region}
murmur_notes_granted_total{reason, region}
murmur_purchases_total{provider, status, region}
murmur_rate_limited_total{route, region}
```

Histograms:

```
murmur_transcribe_duration_ms{provider, phase}    // phase: decode | denoise | pitch | polish | total
murmur_arrangement_duration_ms{vibe}
murmur_render_mp3_duration_ms{}
murmur_route_duration_ms{route, status}            // Next.js per-route SLO
```

Gauges:

```
murmur_users_active_daily
murmur_users_notes_balance_total
murmur_audio_worker_queue_depth                    // if/when we add a queue
```

### SLOs

Codex sets these as alerting rules; first version below, tuned later
from real numbers.

| SLO | Target | Window |
|---|---|---|
| `POST /api/transcribe` p95 latency | ≤ 3 s | rolling 5 min |
| `POST /api/transcribe` 5xx rate | < 0.5 % | rolling 30 min |
| `POST /api/songs` 5xx rate | < 0.5 % | rolling 30 min |
| Webhook signature failures | 0 (page on any) | event |
| Notes-ledger invariant breach | 0 (page on any) | nightly job |

Pages go to one human (whoever is on-call) + a Slack / 飞书 channel.

---

## 4. Traces

One trace per inbound HTTP request, propagated across the Next.js
process and into the audio worker.

- Next.js: OpenTelemetry HTTP instrumentation; spans wrap the route
  handler and DB queries.
- Audio worker: `opentelemetry-instrumentation-fastapi`; spans wrap
  `decode`, `denoise`, `pitch`, `polish` so the bottleneck is visible
  at a glance.
- Trace IDs are echoed in the `X-Request-Id` header back to the client.

### Trace context propagation

Next.js → audio worker: pass the W3C `traceparent` header through the
worker fetch in `apps/web/src/lib/audio/worker-client.ts`. The worker's
FastAPI instrumentation will attach to it.

Client → server: the Web shell injects `traceparent` from the
in-browser Sentry / OTel SDK if present; otherwise the server
originates the trace.

---

## 5. Error reporting

Sentry (intl) + 腾讯云 APM (cn). Same SDK shape:

- Capture exceptions in the global Next.js error boundary +
  every `errorEnvelope` call.
- Capture Python worker exceptions via `sentry-sdk`.
- Tag every event with: `userId`, `requestId`, `region`, `release`,
  `route`, `shell`.
- Source maps uploaded on every release so stack traces are readable.

### Privacy

- **Never include the raw audio blob in any report.**
- **Never include the raw `melody.notes` array.** Note count is OK.
- **Never include user emails.** UserId is OK.
- **PII redactor** runs on metadata before send.

A small wrapper in `apps/web/src/lib/observability/sentry.ts` encodes
all of this.

---

## 6. Dashboards

Codex builds three dashboards in the chosen vendor:

### 6.1 Audio Health

- `transcribe_requests_total` by provider (stacked area).
- `transcribe_failures_total` by error_code (lines).
- `transcribe_duration_ms` p50 / p95 / p99 (histogram heatmap).
- `denoise_ms` + `pitch_ms` + `polish_ms` breakdown.
- Top 10 user IDs by failure count (table; filter for repeat-victim
  pattern).

### 6.2 Product Loop

- Funnel: Hum start → Transcribe success → Vibe pick → Save success.
- Daily active users.
- Songs saved per region per day.
- Studio edits per session (median + p95).

### 6.3 Revenue + Ledger

- Notes purchased per day (by SKU, by region).
- Notes spent per day (by reason).
- Daily ledger invariant check status.
- Refunds + failed purchases.

Each dashboard owns one question. No mega-dashboards.

---

## 7. Client-side observability

The shells emit:

- Performance metrics: Web `Performance.mark()` + `Performance.measure()`
  for first-input-to-first-audio.
- `memory.reportAction` events from each page (`page-contracts.md`).
- Sentry on the Web side; firebase-crashlytics or equivalent on
  Capacitor native crashes.

The audit-event pipeline (`memory.reportAction`) gets a server backing
in v2 (Postgres `audit_events` or an external store). The client → server
post happens via `POST /api/audit` with batching: 10 events or 5 s,
whichever first.

We do **not** load Google Analytics, Segment, or other generic SDKs.
The user-action surface is the audit-event log.

---

## 8. Audio worker specifics

The audio worker is the most likely source of "音频结果不对," so it
gets extra treatment:

- **Every request emits a diagnostic JSON** alongside the response:
  `provider`, `denoiseMs`, `pitchMs`, `polishMs`, `snr`,
  `voicedRatio`, `noteCount`, `warningCodes`.
- **Sample audio retention**: when a request returns 422 OR when the
  diagnostic `voicedRatio < 0.2`, the request audio is stored to a
  bounded bucket (`murmur-debug-audio`) for 24 hours, with a hash of
  the user ID (not the user ID itself). On-call can spot-check.
- **Replay endpoint** in `workers/audio-engine` (dev-only):
  `POST /replay` takes a stored sample id and runs the pipeline,
  returning the full diagnostic JSON. Codex implements this as the
  primary debugging affordance.

---

## 9. Cost discipline

Observability adds cost; budget it.

- Logs: cap at ~5 events per user-action; if the count is climbing,
  consolidate before adding.
- Metrics: avoid high-cardinality labels. `userId` and `requestId` are
  **trace** fields, not metric labels.
- Traces: head-based sampling (10 %) in prod; 100 % in dev. Pin to 100
  % on a specific user via `X-Debug: true` header during incident
  investigation.

When unsure, choose **one** of logs / metrics / traces to instrument a
new code path; do not instrument all three.

---

## 10. Health endpoints

Every service publishes:

- `GET /health` — liveness; returns `{ status: "ok", release }`.
- `GET /ready` — readiness; checks DB + worker availability.
- `GET /metrics` — Prometheus exposition for the metrics in §3.

Probes hit these every 30 s. Probes never have side effects.

---

## 11. Acceptance criteria

A downstream agent has shipped observability v2 when:

- [ ] No raw `console.log` lives in `apps/web/src/app/api/`. The lint
      flags them.
- [ ] Every route emits its taxonomy event from §2 on success and
      failure.
- [ ] The audio worker emits the diagnostic JSON described in §8 for
      every request.
- [ ] The three dashboards in §6 exist and load.
- [ ] At least one alert in §3 fires correctly when triggered by a
      synthetic failure.
- [ ] Source maps upload on release.
- [ ] PII redactor blocks audio bytes, raw note arrays, and emails
      from any report.

---

## 12. Out of scope

- Real-user-monitoring beyond what Sentry's web vitals integration
  provides.
- A custom feature-flag service (use a vendor or an env-driven config).
- A custom audit log analyzer; the dashboards and stored events suffice
  at v2 scale.

Sibling docs: `engineering-standards.md`, `api-conventions.md`,
`testing-strategy.md`, `audio-pipeline-redesign.md`.
