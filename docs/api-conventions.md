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
POST   /api/songs/sng_01H…/share        create/read public playback link
GET    /api/public/songs/abc234defg     public playback payload
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

**Not implemented / planned.** The intent was for "list of user's X"
queries to funnel through a shared `paginate()` helper in
`src/lib/api/paginate.ts`, but that helper was never built and no list
route wires up the cursor contract yet (e.g. `GET /api/songs` currently
returns an unpaginated list). The shape above is the spec such a helper
would follow.

---

## 5. Auth + sessions

See `user-model.md` §4. From the API's view:

- Every route except `/api/auth/login/*`, `/api/billing/webhook/*`, and
  `/api/health` requires a session.
- Public playback read routes under `/api/public/*` are intentionally
  anonymous. They must validate opaque public identifiers, rate-limit by
  client IP, and return only share-safe fields.
- `resolveRequestAuth(request)` is the production identity boundary. Routes
  must not derive `userId` from client-supplied local headers directly.
- Session resolved in this order:
  1. `Authorization: Bearer <token>` (Capacitor + MP).
  2. `__murmur_session` cookie (Web).
  3. Auth.js/NextAuth Web session only as a compatibility fallback during
     OAuth redirect/adoption. Normal Web OAuth completion immediately calls
     `/api/auth/oauth/adopt` and receives a Murmur session cookie.
  4. fallback: no session → 401 `unauthorized`.
- This production-like behavior is also the default on localhost. In explicit
  `MURMUR_AUTH_MODE=local` or `demo`, no-session requests may resolve to the
  local `guest` identity so preview fallback work remains possible.
- The Hum preview path is the narrow exception: routes may call
  `resolveRequestAuth(request, { allowGuestPreview: true })` only when the
  product explicitly allows Local Creator traffic. This does not grant cloud
  ownership, account, or payment access. Local Creator sessions have a finite
  server ledger allowance; pure guest preview fallback is restricted to
  local/dev demo conditions and remains rate-limited.

The `x-murmur-user-id` header from v1 is no longer a production identity
source. It is accepted only outside production auth mode, and only when
`MURMUR_ALLOW_HEADER_AUTH=true` or in `MURMUR_AUTH_MODE=local` by default.
In `MURMUR_AUTH_MODE=demo`, guest fallback is allowed but header identity is
off unless explicitly enabled. Login, refresh, and provider-link management
build on top of the same Murmur session boundary.

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
| Public playback (`/api/public/songs/*`) | 120 / min / IP | same |

Exceeded: return `429 rate_limited` with `Retry-After` in seconds.

Implementation: a token-bucket store behind `src/lib/rate-limit/`
(Postgres adapter in production, in-memory in dev; a `redis` driver
value is recognized but falls back to memory until built). Routes call
the shared helper:

```ts
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";

const rateLimit = await checkApiRateLimit({
  route: "/api/transcribe",
  bucket: "transcribe:user",
  userId: auth.user.id,        // or client IP for guest endpoints
  requestId,
  options: { capacity: 10, refillWindowMs: 60_000 },
});
if (!rateLimit.allowed) return rateLimitedResponse(rateLimit, requestId);
```

---

## 8. Idempotency

**Not implemented / planned.** The generic `Idempotency-Key` header
mechanism and `src/lib/api/idempotency.ts` described in this section were
never built; the text below is the intended spec, not current behavior.
Where idempotency exists today it is per-route: webhook routes dedupe on
the hashed provider event id (see the note at the end of this section),
and `POST /api/songs` reuses client-minted draft ids for save retries.

Mutating routes accept an `Idempotency-Key` header (ulid). The server
records `idempotency_key + userId + route` for 24 hours and returns
the cached response on repeat. Implementation specified for
`src/lib/api/idempotency.ts` (not yet implemented).

Routes that **must** use this:

- `POST /api/songs` (save can be retried by a flaky network)
- `POST /api/songs/[id]/export` (avoid double-charging the user)
- `POST /api/billing/checkout` (don't create two Stripe sessions)
- `POST /api/auth/login/init`

Routes that do not need it: pure reads, account-delete (deliberately
not idempotent so the confirmation step is meaningful).

Webhook routes are idempotent on their own (we hash the provider event
id; duplicates are no-ops).

## 9. Song Share Links

Song sharing has two separate route families:

- `POST /api/songs/[id]/share` is owner-authenticated. It creates or reuses an
  opaque `shareCode`, sets `visibility` to `unlisted` by default, and returns
  `{ shareCode, visibility, url }`. It rejects `private` as an input because
  unpublishing is an edit/privacy action, not link creation. If the deployment
  has not run the share-link migration, it returns `503 schema_unavailable`
  instead of a generic 500 so operators know to run `bun run db:migrate`.
- `GET /api/public/songs/[shareCode]` is anonymous. It returns the minimal
  public playback payload for `unlisted` and `public` songs only.

Visibility semantics:

- `private`: owner routes only.
- `unlisted`: anyone with `/s/[shareCode]` can listen; the response is
  `noindex, nofollow` and not shared-cacheable.
- `public`: eligible for future search/community surfaces and short shared
  caching.

The public payload must not include `userId`, `arrangementState`, raw account
metadata, billing data, or owner-only controls. Future community/search routes
should build on `visibility = 'public'` and should not widen the `/api/public`
playback payload unless the player needs the field.

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

Codex implements every route from this skeleton. The imports and call
shapes below reflect the actual helpers in the codebase today.

```ts
// src/app/api/<area>/<resource>/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api/error-response";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import { log } from "@/lib/observability/log";

const ROUTE = "/api/<area>/<resource>";
const CREATE_RATE_LIMIT = { capacity: 20, refillWindowMs: 60_000 };

const bodySchema = z.object({ /* ... */ });

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);

  // Discriminated union: { ok: false, response } short-circuits.
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "create:user",
    userId: auth.user.id,
    requestId,
    sessionId: auth.sessionId,
    options: CREATE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return errorResponse("validation_error", 400, requestId);
  }

  try {
    const result = await createSong({ userId: auth.user.id, ...body });
    log("song.created", { songId: result.id }, {
      route: ROUTE,
      requestId,
      userId: auth.user.id,
    });
    return NextResponse.json(result, {
      status: 201,
      headers: { "X-Request-Id": requestId },
    });
  } catch (error) {
    log("song.create_failed", {
      message: error instanceof Error ? error.message : String(error),
    }, { route: ROUTE, requestId, userId: auth.user.id, level: "error" });
    return errorResponse("server_error", 500, requestId);
  }
}
```

`errorResponse(code, status, requestId)` (in
`src/lib/api/error-response.ts`) builds the §3 error envelope and always
sets `X-Request-Id`. Codes are plain strings today; the route picks the
`ErrorCode` explicitly — there is no automatic throw-type → code mapping,
and runtime validation of codes at the boundary is planned follow-up
work, not yet built.

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
