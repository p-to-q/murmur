# API Conventions

Every Murmur v2 API route obeys this contract. The contract is small on
purpose: the goal is "if you've seen one of our routes, you've seen all
of them." Downstream agents (and downstream agents' code generators)
read this to know the shape.

Behavior specifics belong in the per-feature docs
(`audio-pipeline-redesign.md`, `payment-topup-feature.md`,
`user-model.md`). This file only specifies the **shape** every route
shares.

---

## 1. Style

REST-ish + JSON, scoped per resource, hosted under `/api/`. We do not
use GraphQL (premature for this surface), and we do not pretend the
routes are RPC.

```
/api/<area>/<resource>[/<id>][/<verb>]
```

Examples:

```
GET    /api/songs                       list
POST   /api/songs                       create
GET    /api/songs/sng_01H…              read
PATCH  /api/songs/sng_01H…              update
DELETE /api/songs/sng_01H…              delete
POST   /api/songs/sng_01H…/export       verb on resource
POST   /api/billing/checkout            non-CRUD action
POST   /api/billing/webhook/stripe      external callback
```

The verb form is reserved for actions that don't fit CRUD cleanly
(`/export`, `/restore`, `/refresh`). Resist inventing new verbs; most
needs are met by HTTP methods.

---

## 2. Identifiers

All ids are **ulids** prefixed by type:

| Prefix | Resource |
|---|---|
| `usr_` | users |
| `sng_` | songs |
| `vrs_` | vibe versions (transient — never persisted; client only) |
| `nle_` | notes ledger entries |
| `pur_` | purchases |
| `ses_` | sessions |
| `sub_` | (reserved) subscriptions |

Prefixing makes log lines self-documenting and makes copy-paste
debugging fast. Validation: regex `^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$`.

ulids are time-ordered, which gives free pagination cursors (§4).

---

## 3. Response envelope

Every route returns one of two shapes.

### 3.1 Success

```ts
// 200 / 201
type SuccessResponse<T> = T;
```

We do **not** wrap success bodies in `{ data: ... }`. The route's name
tells you the resource; the body is the resource. Less ceremony, less
ambiguity for code generators.

Examples:

- `GET /api/songs/[id]` → `Song`
- `POST /api/songs` → `Song`
- `GET /api/songs` → `{ items: Song[], nextCursor: string | null }` (a
  list is its own resource, see §4)

### 3.2 Error

```ts
type ErrorResponse = {
  error: ErrorCode;            // machine-readable, stable
  message?: string;            // human-readable, English; client may i18n
  details?: Record<string, unknown>;
  requestId: string;           // matches the X-Request-Id header
};
```

`ErrorCode` is enumerated per route in its own response type; **all**
routes share the framework codes below in addition to their specific
codes.

| Code | HTTP | Meaning |
|---|---|---|
| `unauthorized` | 401 | no / invalid session |
| `forbidden` | 403 | session valid but action not allowed |
| `not_found` | 404 | id given does not exist or is not yours |
| `validation_error` | 400 | malformed body / params |
| `insufficient_notes` | 402 | balance < cost; client navigates to `/topup` |
| `rate_limited` | 429 | too many requests (see §7) |
| `conflict` | 409 | optimistic concurrency / duplicate idempotency key |
| `server_error` | 500 | unhandled; the only one without a stable message |

Routes that need a specific reason (e.g. `/api/transcribe` returning
`no_voiced_frames` with 422) extend this set.

Clients should switch on `error` and never parse `message`. `message`
is for the toast / log, not for control flow.

---

## 4. Pagination

Cursor-based, never offset.

```
GET /api/songs?limit=50&cursor=sng_01H…
→
{
  items: Song[],
  nextCursor: string | null,    // null = no more pages
  total?: number                // optional, only included when cheap
}
```

- `limit` default 50, max 100.
- Cursor is the ulid of the **last item returned** in the previous page.
- Sort order: `createdAt DESC` (newest first) for all owned lists.
- A client polling for new items uses `?since=<ulid>` (returns
  newer-than) instead of pagination; mutually exclusive with `cursor`.

Internally, "list of user's X" queries always pass through a shared
`paginate()` helper in `src/lib/api/paginate.ts` (Codex implements; spec
is §4 of this doc).

---

## 5. Auth + sessions

See `user-model.md` §4. From the API's view:

- Every route except `/api/auth/login/*`, `/api/billing/webhook/*`, and
  `/api/health` requires a session.
- `resolveRequestAuth(request)` is the production identity boundary. Routes
  must not derive `userId` from client-supplied local headers directly.
- Session resolved in this order:
  1. `Authorization: Bearer <token>` (Capacitor + MP).
  2. `__murmur_session` cookie (Web).
  3. Auth.js/NextAuth Web session, while the Google login path is still being
     adopted into Murmur's opaque session table.
  4. fallback: no session → 401 `unauthorized`.
- This production-like behavior is also the default on localhost. In explicit
  `MURMUR_AUTH_MODE=local` or `demo`, no-session requests may resolve to the
  local `guest` identity so preview fallback work remains possible.
- The Hum preview path is the narrow exception: routes may call
  `resolveRequestAuth(request, { allowGuestPreview: true })` only when the
  product explicitly allows Local Creator traffic. This does not grant cloud
  ownership, billing, account, or payment access. The current Web 5-note Local
  Creator allowance is enforced by the client preview path; server preview
  routes remain rate-limited but do not spend ledger notes for Local Creator
  sessions until server-side Local Creator quotas ship.

The `x-murmur-user-id` header from v1 is no longer a production identity
source. It is accepted only outside production auth mode, and only when
`MURMUR_ALLOW_HEADER_AUTH=true` or in `MURMUR_AUTH_MODE=local` by default.
In `MURMUR_AUTH_MODE=demo`, guest fallback is allowed but header identity is
off unless explicitly enabled. Login, refresh, and full Auth.js → Murmur
opaque session adoption remain the follow-up work.

---

## 6. File uploads (audio + MP3)

Two upload modes:

### 6.1 Direct multipart (audio)

`POST /api/transcribe` accepts `multipart/form-data` with the audio
blob inline. Used because:

- The audio is small (≤2 MB) and goes straight to the worker.
- The worker needs it in memory anyway for processing.
- The client never needs the audio URL back.

### 6.2 Presigned PUT (rendered MP3)

`POST /api/songs/upload-token` returns a presigned URL the client can
PUT the MP3 to directly. Then `POST /api/songs` persists the resulting
URL, not the audio bytes.

Sequence:

```
1. client: POST /api/songs/upload-token  {kind:"song_mp3", contentType:"audio/mpeg"}
   ← {uploadUrl, publicUrl, expiresAt}
2. client: PUT <uploadUrl> with the MP3 bytes
3. client: POST /api/songs {..., mp3Url: <publicUrl>, ...}
```

Why two-step: keeps the Next.js API thin, avoids streaming through
serverless functions, scales to large files later, and is the standard
S3 / R2 / 腾讯云 COS shape.

`upload-token` lives behind notes-balance check (1 note debited and
held; refunded if `/api/songs` is not called within 10 minutes).

---

## 7. Rate limiting

Per route + per user (or per IP for guest endpoints).

| Class | Limit | Headers |
|---|---|---|
| Read (`GET`) | 60 / min | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| Mutate (`POST` / `PATCH` / `DELETE`) | 20 / min | same |
| Expensive (`/api/transcribe`, `/api/strummer/edit`, `/api/songs/*/export`) | 10 / min | same |
| Auth (`/api/auth/login/*`) | 5 / min / IP | same |

Exceeded: return `429 rate_limited` with `Retry-After` in seconds.

Implementation: lightweight Redis (when scaling demands) or in-process
counter with backoff (fine for early v2). Live behind a helper:

```ts
import { rateLimit } from "@/lib/api/rate-limit";
await rateLimit(req, "transcribe", { perMin: 10 });
```

---

## 8. Idempotency

Mutating routes accept an `Idempotency-Key` header (ulid). The server
records `idempotency_key + userId + route` for 24 hours and returns
the cached response on repeat. Implementation lives in
`src/lib/api/idempotency.ts`.

Routes that **must** use this:

- `POST /api/songs` (save can be retried by a flaky network)
- `POST /api/songs/[id]/export` (avoid double-charging the user)
- `POST /api/billing/checkout` (don't create two Stripe sessions)
- `POST /api/auth/login/init`

Routes that do not need it: pure reads, account-delete (deliberately
not idempotent so the confirmation step is meaningful).

Webhook routes are idempotent on their own (we hash the provider event
id; duplicates are no-ops).

---

## 9. Versioning

We do not put `/v1/` in the URL. Reasons:

- One backend, one set of clients we control.
- Add a version when a real breaking change ships **and** we cannot
  migrate clients in lockstep. Not true today.

If we ever need it, the convention is `/api/v2/<area>/...` and the old
path stays for two release windows then deletes. Codex follows
`/api/...` for now.

Backward-incompatible response changes during v2 are handled by
**adding** new fields, not changing existing ones. If a field must be
removed, mark it `@deprecated` for one release window first.

---

## 10. Webhooks

External providers (Stripe, WeChat Pay, RevenueCat) call
`/api/billing/webhook/<provider>`. Each route:

1. Verifies the signature using a provider-specific scheme.
2. Records the raw event in `events_webhook` (a separate table; see
   `data-model.md` §3.5) — idempotent on the provider's event id.
3. Returns `200` quickly; long work (ledger writes) happens inside the
   request because at v2 scale the work is small. Move to a queue when
   the median webhook write exceeds 200 ms.

Signature verification is **mandatory**, not optional. A webhook route
that cannot verify its signature must return 401 and **not** write
anything.

---

## 11. Conventions on the request side

- **JSON bodies only** (except multipart for `/api/transcribe`).
- **Booleans are explicit booleans**, never the strings `"true" / "false"`.
- **Timestamps are ISO 8601 UTC strings** (`Z` suffix). Never epoch
  milliseconds, never local time.
- **Currency amounts are integers in the smallest unit** (cents for
  USD, 分 for CNY). The `currency` field disambiguates.
- **Enums are kebab-case strings** in payloads but live as
  `kebab_case` const unions in TypeScript.

---

## 12. Common headers

| Header | Direction | Notes |
|---|---|---|
| `Authorization: Bearer <token>` | request | Capacitor + MP shells |
| `Cookie: __murmur_session=...` | request | Web shell |
| `Idempotency-Key: <ulid>` | request | mutating routes |
| `X-Request-Id: <ulid>` | request OR response | echoed in error envelope; clients pass theirs in for tracing |
| `X-Murmur-Shell: web | ios | android | wechat_mp | server` | request | shells set this so server-side metrics can break down by surface |
| `X-Murmur-Region: intl | cn` | request | hints region; server validates against the resolved session |

---

## 13. Standard route template

Codex implements every route from this skeleton. The helper names in the
snippet are illustrative; the current app may use narrower route-local
adapters as long as the same response contract holds.

```ts
// src/app/api/<area>/<resource>/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/api";        // resolves session
import { rateLimit }    from "@/lib/api/rate-limit";
import { withIdempotency } from "@/lib/api/idempotency";
import { logRequest, errorEnvelope } from "@/lib/api/envelope";
import { z } from "zod";

const BodySchema = z.object({ ... });
type Body = z.infer<typeof BodySchema>;

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
  const auth = await authenticate(req);  // throws unauthorized
    await rateLimit(req, "songs-create", { perMin: 20, userId: auth.user.id });
    const body = BodySchema.parse(await req.json());
    return withIdempotency(req, async () => {
      const result = await createSong({ userId: auth.user.id, ...body });
      logRequest(requestId, req, 200, { kind: "song.created", id: result.id });
      return NextResponse.json(result, {
        status: 201,
        headers: { "X-Request-Id": requestId },
      });
    });
  } catch (e) {
    return errorEnvelope(e, requestId);
  }
}
```

`errorEnvelope` maps known throw-types to `ErrorCode`; the unknown
falls to `server_error`. It always sets `X-Request-Id`.

---

## 14. What this convention deliberately leaves out

- **HATEOAS / hypermedia.** Not worth the cost.
- **JSON-Schema published per route.** TS types generated from `zod`
  schemas are enough at v2 scale; we can publish OpenAPI later from the
  same `zod` definitions if a partner needs it.
- **Request signing beyond auth.** Bearer token + cookie are the only
  per-request auth signals.
- **gRPC / streaming.** v2 is small enough that JSON over HTTP is the
  right floor.

---

## 15. Acceptance criteria

A downstream agent has implemented these conventions when:

- [ ] Every existing route in `src/app/api/` matches the
      template + error envelope.
- [ ] Every new route uses `resolveRequestAuth` or an equivalent
      adapter and emits a `requestId`.
- [ ] All ulid ids are typed-prefix and validated server-side.
- [ ] `Idempotency-Key` is enforced on the routes listed in §8.
- [ ] Rate limits in §7 are active.
- [ ] Webhook routes verify signatures and short-circuit duplicates.
- [ ] At least one happy-path + one error-path integration test exists
      per route (see `testing-strategy.md`).

Sibling docs: `user-model.md`, `payment-topup-feature.md`,
`audio-pipeline-redesign.md`, `data-model.md`, `observability.md`.
