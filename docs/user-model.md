# User Model

This document fixes the user layer for Murmur v2: identity, plans,
entitlements, regions, sessions, and the state transitions between them.
Every other v2 doc that touches a user (auth, payment, page contracts,
APIs, audit logs) reads from here.

When a downstream agent needs to know "what counts as a user," "what can
this user do," or "what changes when a guest signs in," this file is the
answer.

---

## 1. Why this exists

Today's app (`diagnosis-2026-06.md` §1) treats every request as a
`guest` user unless an `x-murmur-user-id` header is set, which any
caller can forge. That makes payment and personalization impossible to
ship safely. v2 needs a real model where:

- The server knows who the request is from, with cryptographic backing.
- The user knows what tier they are on and what they can do today.
- The product knows when to upsell, when to gate, and when to ignore.
- The audit log knows whose action it is recording.

The shape below is the minimum surface that satisfies those four.

---

## 2. User types

Three kinds of users exist at runtime. Every authenticated user has
exactly one type at a time. The type drives gating + UI surfacing, NOT
schema (a single `users` row covers all three; the type is computed).

| Type | Signal | Default behavior |
|---|---|---|
| **`guest` / Local Creator** | Murmur session with `users.accountKind == "local_creator"`; no external identity yet | Limited preview: 5 notes once for this browser-backed server row. Can hum, save, reopen, and manage its own songs on this browser. Top-up, purchases, account deletion, cross-device sync, and account-sensitive actions require sign-in. |
| **`free`** | Authenticated, `planTier == "free"` | Full surface. 15 notes once on sign-in, then paid top-up. |
| **`premium`** | Authenticated, `planTier == "premium"` (reserved for v3) | Full surface. Unlimited core actions. |

`type` is derived by the auth resolver (server-side) and exposed to the
client via `useCurrentUser()` (see `page-contracts.md` §11).

```ts
function userType(user: User | null): "guest" | "free" | "premium" {
  if (!user) return "guest";
  if (user.planTier === "premium") return "premium";
  return "free";
}
```

### Why allow guests at all

WeChat MP openid resolution is automatic; iOS / Android can require sign-
in immediately; only the **Web** shell has a meaningful Local Creator tier —
and even there, only to lower the "play with it" activation barrier. Guest
support is intentionally small: 5 notes once, no refill, and a login wall once
the allowance is spent. The Local Creator session has a real owner row and a
finite server ledger, while pure no-session guest fallback is only for local/dev
preview resilience. Guest support is one-way: a Local Creator can be promoted to
a real user, but a real user is never demoted to guest.

---

## 3. Identity providers per shell

| Shell | Primary provider | Fallback | Session medium |
|---|---|---|---|
| Web (intl) | Sign in with Google, Sign in with GitHub | email verification code | Murmur opaque session cookie (`__murmur_session`) |
| Web (cn) | WeChat OAuth, 微信扫码登录 | phone OTP (短信) | same cookie |
| iOS (Capacitor) | Sign in with Apple **required** (App Store rule) | Apple only | Keychain-backed session token, forwarded as `Authorization: Bearer` |
| Android (Capacitor) | Google Sign-In | Google only | Encrypted-storage token |
| WeChat MP | `wx.login` → server exchanges code for openid + session_key | none | `Set-Cookie` via wx adapter |

Server has one resolver, multiple ingestors. The resolver normalizes to
a `User` row keyed by `users.id` (a Murmur-internal ulid) with a
`users.externalIdentities[]` map:

```ts
type ExternalIdentity = {
  provider: "apple" | "google" | "github" | "wechat" | "wechat_mp" | "email";
  externalId: string;     // sub | openid | email
  linkedAt: string;       // ISO timestamp
};
```

The `users.email` column is used for display + magic-link routing
**only**. Identity lookup goes through `external_identities` (a side
table; see `data-model.md` §3.2).

### Why a separate table

Apple sub + Google sub + GitHub id + WeChat openid are different namespaces.
A user could link two; we don't want to overload `users.email` with
provider strings. The side table also gives us an audit trail when a
provider key rotates.

This follows the same product shape as dedicated identity products: the
application has one user profile, and multiple provider identities can link
to it. Auth0 documents this as letting people authenticate through different
providers while still being recognized as the same application user; Clerk's
account-linking model likewise connects multiple external accounts into one
account when the ownership signal is trusted. Auth.js is intentionally more
conservative and does not automatically link by email unless the provider is
explicitly trusted. Murmur therefore keeps the policy in our own
`external_identities` table instead of letting any provider session become the
product user by itself.

---

## 4. Sessions

Server-issued, signed, opaque. **Not** JWTs unless we genuinely need
audience federation later (v2 doesn't).

Production identity source of truth: `resolveRequestAuth(request)` returns a
Murmur `users.id` from a validated Murmur opaque session token/cookie. Web
OAuth still starts through Auth.js, but `/api/auth/oauth/adopt` immediately
turns a successful Google/GitHub provider session into a Murmur session. The
provider session is not the product identity. `guest`, local storage users,
and `x-murmur-user-*` headers are allowed only in explicit local/demo auth
modes and must never gate payment, cloud ownership, or account-sensitive
actions in production.

```ts
type Session = {
  id: string;            // ulid
  userId: string;
  shell: "web" | "ios" | "android" | "wechat_mp";
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;     // 30 days from issuedAt
  revokedAt: string | null;
};
```

Cookie (Web + MP):

```
Set-Cookie: __murmur_session=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
```

Capacitor: shell stores the session token in Keychain / EncryptedSharedPreferences,
and the API client injects `Authorization: Bearer <token>` on every
fetch. Web uses the opaque `__murmur_session` cookie. Auth.js / NextAuth may
still initiate OAuth redirects, but production API identity is the Murmur
session resolved by `resolveRequestAuth()`, not the provider session object
itself.

The session choice also follows OWASP's session-management guidance: keep a
server-side session identifier that is unique, difficult to predict, revocable,
and bounded by an absolute timeout. Murmur stores only the SHA-256 token hash
in `sessions`, sends the opaque token in an HttpOnly SameSite cookie on Web,
and revokes by row on logout or account deletion.

### Industry references

- [Auth0 user account linking](https://auth0.com/docs/manage-users/user-accounts/user-account-linking):
  multiple identity providers can authenticate the same app user profile.
- [Auth.js provider account linking](https://authjs.dev/reference/core/providers#allowdangerousemailaccountlinking):
  automatic linking by email is disabled by default unless the provider's
  email verification is explicitly trusted.
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html):
  keep the session id meaningless to the client, store session state on the
  server, and set cookie attributes such as HttpOnly / SameSite / Secure.

### Session lifecycle

- Login → insert session row, mark previous sessions of the same shell
  as `revoked` if `single_session_per_shell == true` (default).
- Logout → set `revokedAt` for the current session.
- 30-day idle → expire automatically; client refreshes on next call.
- Account delete (§7) → revoke ALL sessions immediately.

---

## 5. Entitlements

The "what can this user do today" surface. Entitlements are derived from
`users.planTier` + `users.notesBalance` + `users.regionId`. They are
**never** stored as flags; they are computed per request.

Canonical helper in `packages/murmur-core/auth/entitlements.ts`:

```ts
type Entitlement = {
  canHum: boolean;            // hum→transcribe path
  canSave: boolean;           // /api/songs POST
  canLlmEdit: boolean;        // /api/strummer/edit
  canExportWebm: boolean;     // client video export, MP4 or WebM
  canTopUp: boolean;          // /topup path visible
  canDeleteAccount: boolean;  // settings sheet
  remainingNotes: number;
};

function resolveEntitlement(user: User, balance: number): Entitlement {
  const isAuthed = userType(user) !== "guest";
  return {
    canHum:           balance >= COST.hum,
    canSave:          isAuthed && balance >= COST.save,
    canLlmEdit:       balance >= COST.llm_edit,
    canExportWebm:    isAuthed && COST.export_webm === 0,
    canTopUp:         isAuthed,
    canDeleteAccount: isAuthed,
    remainingNotes:   balance,
  };
}
```

`COST` lives in `packages/murmur-core/payments/cost-table.ts` and matches
`payment-topup-feature.md` §3.

### Gating UX (cross-page)

- A page that wants to invoke a gated action calls
  `useEntitlement()` (a thin wrapper around `useCurrentUser()` +
  `useUserBalance()`), reads the relevant boolean, and either:
  - renders the action enabled, or
  - renders it as a **"need N notes → Top up"** affordance that navigates
    to `/topup`.

- Guest gating routes to `/me` ("Sign in to save") rather than `/topup`.
  Order matters: identity must precede payment.

- Pages do **not** call the gated action and rely on a 402 to detect
  gating. 402 is the safety net; the UI is the first-line gate. The
  reason is latency and graceful degradation — users see the gate
  before they tap.

---

## 6. Region

Single column `users.regionId` ∈ `{ "intl", "cn" }` for v2. It controls:

- Which SKU price card the user sees (USD vs CNY).
- Which auth providers are surfaced (Apple+Google vs WeChat+phone).
- Which deploy region the API calls hit (intl Vercel/Fly vs 腾讯云).
- Which language may seed the i18n picker when no explicit language preference
  exists. The actual first-paint language is negotiated independently from the
  `murmur.lang` cookie and browser language hints, so region never overrides a
  user's chosen locale.

Region is set at first login from a combination of:
1. Device locale (Capacitor exposes; MP defaults to zh-CN).
2. Sign-in provider (Apple ID country, WeChat region).
3. IP geo (last-resort hint only; not authoritative).

Region is **mutable** but only via a deliberate settings change in `/me`
that re-routes the API base URL. Switching region does not move data
between deploys in v2.

### Future: when do we shard

A `region_id` shard column lives on every "owned-by-user" table
(`songs`, `notesLedger`, `purchases`, `sessions`). v2 keeps a single
Postgres per region; data does not move between regions. If a user
needs both, the user has two `users` rows (one per region). Document
the limitation; do not solve it.

---

## 7. Lifecycle: state machine

```
        ┌──────┐
        │  ∅   │       (no row, no session)
        └───┬──┘
        │  first visit (Web only) — Local Creator row
        │  with accountKind="local_creator", 5 notes, and a session cookie
            ▼
        ┌──────┐
        │guest │       browser-bound Gallery; can hum, audit, save
        └───┬──┘
            │  successful signup / signin
            ▼
        ┌──────┐
        │ free │       full surface; signup bonus, then paid top-up
        └───┬──┘
            │  successful subscription (v3 — reserved)
            ▼
        ┌──────┐
        │premium│      reserved
        └───┬──┘
            │  user-initiated account delete
            ▼
        ┌──────┐
        │deleted│      tombstone; all data purged within 30 days
        └──────┘
```

Transitions in detail:

- **`∅ → guest` (Web only).** First Web visit with no Murmur session creates a
  Local Creator row with `id = "lc_" + ulid()`,
  `accountKind = "local_creator"`, `planTier = "free"`, and
  `notesBalance = 5`. A `__murmur_session` cookie binds this browser to the
  row. The user owns songs, but the account is not registered.
- **`guest → free`.** Sign in with Apple / Google / WeChat. If the provider
  identity is new and the current session is an unbound Local Creator, the
  same `users` row is promoted in one SQL transaction:
  `accountKind = "registered"`, provider profile fields are filled, and the
  external identity row is inserted. Songs and ledger rows stay attached
  because `userId` does not change.
- **Existing account + Local Creator.** If the external identity already
  belongs to another registered account, Murmur must not silently merge the
  current browser's Local Creator songs. The safe follow-up is an explicit
  "import this browser's local songs" flow with confirmation and idempotency.
- **`free → premium`.** Reserved. Will be a webhook from the billing
  provider on subscription start.
- **`* → deleted`.** User requests deletion in `/me`. Confirm modal,
  password / re-auth challenge, then:
  - all sessions revoked
  - row marked `deletedAt = now()` (but not yet hard-deleted)
  - background job (within 30 days) cascades the purge to `songs`,
    `notesLedger`, `purchases`, `sessions`, `external_identities`. Apple
    + WeChat require the 30-day window per their respective ToS.
  - account-recovery: a deletedAt-marked row can be undeleted within 7
    days if the same identity attempts a fresh sign-in (post-30-day,
    the user starts fresh).

---

## 8. Auth API surface

| Route | Purpose |
|---|---|
| `POST /api/auth/login/init` | start an OAuth or OTP flow; returns provider redirect URL or challenge |
| `POST /api/auth/login/callback` | server-side callback; sets session cookie / returns token |
| `POST /api/auth/oauth/adopt` | converts a successful Auth.js OAuth session into a Murmur session |
| `POST /api/auth/refresh` | rotate the session token (Capacitor + MP) |
| `POST /api/auth/logout` | revoke current session |
| `GET /api/auth/me` | returns the session-resolved `User` + `Entitlement` |
| `POST /api/auth/link` | link a second provider to an existing user |
| `POST /api/auth/unlink` | unlink a provider (must leave at least one identity) |
| `POST /api/account/delete` | initiate account deletion |
| `POST /api/account/delete/cancel` | cancel deletion within 30 days |

Auth API design follows `api-conventions.md`. Webhooks for billing live
under `/api/billing/webhook/*` (see `payment-topup-feature.md`).

### Why no JWT

A signed opaque session token in a HttpOnly cookie gives us
revocation-by-row, no expiry-leak risk, and a simpler server. JWT adds
value when many services validate independently. We have one backend.
If we later need to validate auth from the audio worker, the worker
makes a tiny `/api/auth/verify` call rather than parsing a JWT.

---

## 9. Data privacy

The user model is bound by two external regimes:

- **App Store + Google Play:** "Sign in with Apple" mandatory if any
  other social provider is used; account-delete pathway visible in the
  app; privacy nutrition labels per data category.
- **微信 + Chinese PIPL:** explicit consent screen on first save;
  data-export and data-delete pathways; logging of consent timestamp.

Add a `users.consents` JSONB column:

```ts
type Consents = {
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  pipl: { acceptedAt: string | null; version: string } | null; // CN only
  marketingOptIn: boolean;
};
```

Migrations adding consent versions must trigger a re-consent prompt; the
client checks `consents.privacyVersion !== CURRENT_PRIVACY_VERSION` on
every login.

### What we store about audio

We do **not** persist raw user recordings by default. The audio worker
discards the upload after producing the `ScoredMelody`. If a future
v2.x improvement (e.g. local model training) needs uploads, we ship an
opt-in toggle in `/me/privacy` and persist with a 90-day TTL.

This is documented in `audio-pipeline-redesign.md` §12.2 and re-stated
here so the user model is self-contained.

---

## 10. Audit log + memory adapter

`memory.reportAction` events (see [memory.ts](../src/lib/platform/memory.ts))
become the unified audit log post-v2:

- All client-driven user actions emit one event with `userId`,
  `sessionId`, `shell`, `page`, `event_type`, and `metadata` per
  `page-contracts.md`.
- All server-initiated mutations (cron refills, webhook ledger writes,
  account deletion progress) emit a server-side `memory.reportAction`
  with `userId` if applicable.

Storage backend for events stays the platform memory adapter today
(local stub). When backed by a real store (Postgres `events` table or
Clickhouse), the schema is:

```ts
type AuditEvent = {
  id: string;             // ulid
  userId: string | null;
  sessionId: string | null;
  shell: "web" | "ios" | "android" | "wechat_mp" | "server";
  page: string;
  eventType: string;      // e.g. "hum_start"
  metadata: Record<string, unknown>;
  occurredAt: string;
};
```

`observability.md` covers retention, downsampling, and dashboard
surface for these events.

---

## 11. Acceptance criteria for the user-model phase

A downstream agent has shipped this when:

- [ ] `users` table extended with `regionId`, `planTier`, `notesBalance`,
      `dailyFreeNotesBalance`, `freeNotesGrantedAt`, `deletedAt`, `consents`.
- [x] `external_identities` table exists; `sessions` table exists.
- [ ] `getRequestUser` + `requireAuth` reject spoofed headers; only
      session cookies / bearer tokens authenticate.
- [x] Email, Google, and GitHub all resolve to one Murmur `users.id` through
      `external_identities`.
- [x] `useCurrentAccount()` returns a stable `/api/auth/me` shape for product
      UI state.
- [ ] Local Creator → authenticated promotion preserves the same `userId`,
      so songs + ledger remain attached without copying.
- [ ] Logout works on Web + Capacitor; sessions are revoked server-side.
- [ ] Account-delete flow works end-to-end including the 30-day
      tombstone job.
- [ ] PIPL consent banner shows for `regionId === "cn"` on first login.

---

## 12. What this model deliberately defers

- Multi-account switching in a single shell (one identity per device).
- SSO across orgs / teams (no team plan).
- Federated identity with a second app of ours (no federation).
- Phone-only sign-in outside of CN (low ROI; covered by email magic
  link).
- Biometrics gating per action (the session already protects).

---

## 13. Where this contract is enforced

| Concern | Enforced in | Notes |
|---|---|---|
| Identity | `src/lib/platform/server-auth.ts` (v2 rewrite) | the *only* source of truth on who the request is |
| Login identity links | `src/lib/db/schema/external-identities.ts` + `src/lib/db/queries/users.ts` | maps email / Google / GitHub to the canonical `users.id` |
| Entitlements | `packages/murmur-core/auth/entitlements.ts` | derived, never stored |
| Region routing | server middleware (Next.js `middleware.ts`) | rewrites the user to the correct deploy if cross-region |
| Audit log | `memory.reportAction` adapter | client + server both call |
| Session storage | `sessions` table + cookie | rotation via `/api/auth/refresh` |

Sibling docs: `page-contracts.md`, `payment-topup-feature.md`,
`api-conventions.md`, `data-model.md`, `cross-platform-strategy.md`.
