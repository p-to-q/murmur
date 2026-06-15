# Data Model

The authoritative list of every Postgres table Murmur ships in v2.
This is the file Codex reads when generating a Drizzle schema,
authoring a migration, or writing a query. If a table is not here, it
does not exist; if a field is not here, it does not exist.

Behavioral semantics for each table live in the feature docs
(`user-model.md`, `payment-topup-feature.md`,
`audio-pipeline-redesign.md`); this file is the **shape**, plus the
constraints, indexes, and migration order.

---

## 1. Conventions

- All tables live in `apps/web/src/lib/db/schema/<entity>.ts`.
- One table per file. Re-export in `schema/index.ts`.
- Primary keys are ulid strings with a type prefix
  (`api-conventions.md` §2).
- `created_at` + `updated_at` are required on every mutable row.
- Soft-delete via `deleted_at` (timestamp nullable) on rows that
  have an account-deletion or user-driven delete path; hard-delete
  otherwise.
- Indexes are explicit and listed per table; never assume default.
- Foreign keys are declared in the schema but Drizzle's `references`
  is the only enforcement (Postgres FKs ON, ON DELETE behavior named
  per table).

---

## 2. Migration order

```
v2-0001  users.alter           (extend users; non-breaking defaults)
v2-0002  external-identities
v2-0003  sessions
v2-0004  notes-ledger
v2-0005  purchases
v2-0006  songs.alter           (add melody jsonb + mp3Url; nullable)
v2-0007  songs.backfill        (one-off, see §3.1)
v2-0008  events-webhook
v2-0009  rate-limits           (optional; redis preferred)
v2-0010  audit-events          (optional; clickhouse preferred)
```

Each migration must be reversible. Drizzle generates `up.sql` +
`down.sql`. Codex commits both.

---

## 3. Tables

### 3.1 `users` (extended)

Current shape in
[users.ts](../src/lib/db/schema/users.ts): id /
email / name / avatarUrl / createdAt / updatedAt.

v2 additions:

```ts
notesBalance:       integer("notes_balance").notNull().default(15),
freeNotesGrantedAt: timestamp("free_notes_granted_at").notNull().defaultNow(),
planTier:           varchar("plan_tier", { length: 16 }).notNull().default("free"),
regionId:           varchar("region_id", { length: 8 }).notNull().default("intl"),
deletedAt:          timestamp("deleted_at"),
consents:           jsonb("consents").$type<Consents>().notNull().default(sql`'{"termsAcceptedAt":null,"privacyAcceptedAt":null,"pipl":null,"marketingOptIn":false}'`),
```

Constraints:

- `planTier IN ("free", "premium")`.
- `regionId IN ("intl", "cn")`.
- `notesBalance >= 0` (enforced in app; DB check optional).

Indexes (in addition to existing email + createdAt):

- `users_plan_tier_idx ON (plan_tier)`
- `users_region_id_idx ON (region_id)`
- `users_deleted_at_idx ON (deleted_at)` — partial where `deleted_at IS NOT NULL`

Backfill (§v2-0001 → v2-0007):

- Every existing user gets `notesBalance = 50` (the v2 cutover gift,
  see `payment-topup-feature.md` §12).
- `freeNotesGrantedAt = now()`.
- `planTier = "free"`.
- `regionId = "intl"` for everyone (until region detection lands).
- `consents = { termsAcceptedAt: null, ... }` — forces re-consent.

### 3.2 `external_identities` (NEW)

```ts
export const externalIdentities = pgTable(
  "external_identities",
  {
    id:         text("id").primaryKey(),               // ulid `eid_…`
    userId:     text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider:   varchar("provider", { length: 16 }).notNull(),
    // provider: "apple" | "google" | "wechat" | "wechat_mp" | "email"
    externalId: varchar("external_id", { length: 256 }).notNull(),
    linkedAt:   timestamp("linked_at").notNull().defaultNow(),
    metadata:   jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  },
  (t) => ({
    uniqueIdentity:    uniqueIndex("ext_id_provider_external_idx").on(t.provider, t.externalId),
    byUser:            index("ext_id_user_idx").on(t.userId),
  }),
);
```

Constraints:

- A user must have ≥1 identity (enforced in app code, not DB).
- `(provider, externalId)` is unique globally; the same Apple ID cannot
  bind to two `users` rows.

### 3.3 `sessions` (NEW)

```ts
export const sessions = pgTable(
  "sessions",
  {
    id:         text("id").primaryKey(),  // ulid `ses_…`
    userId:     text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shell:      varchar("shell", { length: 16 }).notNull(),
    // shell: "web" | "ios" | "android" | "wechat_mp"
    tokenHash:  varchar("token_hash", { length: 128 }).notNull(),  // sha-256 of opaque token
    issuedAt:   timestamp("issued_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    expiresAt:  timestamp("expires_at").notNull(),
    revokedAt:  timestamp("revoked_at"),
    metadata:   jsonb("metadata").$type<{ userAgent?: string; ip?: string }>().notNull().default(sql`'{}'`),
  },
  (t) => ({
    byUser:    index("sessions_user_idx").on(t.userId),
    byToken:   uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    byExpiry:  index("sessions_expires_at_idx").on(t.expiresAt),
  }),
);
```

The token itself is **never stored**; only its SHA-256 hash. The
opaque token leaves the server once (in the `Set-Cookie` or login
response) and is provided by the client thereafter.

### 3.4 `notes_ledger` (NEW)

```ts
export const notesLedger = pgTable(
  "notes_ledger",
  {
    id:          text("id").primaryKey(),                   // ulid `nle_…`
    userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    delta:       integer("delta").notNull(),                // signed
    reason:      varchar("reason", { length: 32 }).notNull(),
    // reason taxonomy:
    //   "spend:hum" | "spend:llm_edit" | "spend:save" | "spend:export_webm"
    //   "grant:daily_free" | "grant:signup_bonus" | "grant:cutover_gift"
    //   "purchase:topup" | "refund:topup" | "manual:op_grant"
    externalRef: text("external_ref"),                       // provider tx id, song id, etc.
    metadata:    jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byUser:        index("ledger_user_idx").on(t.userId, t.createdAt),
    byReason:      index("ledger_reason_idx").on(t.reason, t.createdAt),
    byExternalRef: index("ledger_external_ref_idx").on(t.externalRef),
  }),
);
```

Invariants:

- The sum of `delta` over a user's rows == `users.notesBalance`. Always.
  A nightly reconciliation job fails loud if they diverge.
- No row is ever updated or deleted. Provider top-up refunds insert a
  negative `refund:topup` row keyed by the provider refund event; failed-spend
  refunds insert a positive `refund:spend` row keyed by the original spend.
- Every business action that consumes or grants notes inserts exactly
  one ledger row inside the same SQL transaction as the action itself.

Helper in `apps/web/src/lib/db/queries/notes-ledger.ts`:

```ts
async function spendNotes(
  userId: string,
  cost: number,
  reason: NotesReason,
  externalRef?: string,
): Promise<{ ok: true } | { ok: false; reason: "insufficient_notes" }>
```

Acquires `SELECT ... FOR UPDATE` on the user row, checks balance,
inserts ledger row, updates balance, commits. Returns the typed
result.

### 3.5 `purchases` (NEW)

```ts
export const purchases = pgTable(
  "purchases",
  {
    id:           text("id").primaryKey(),               // ulid `pur_…`
    userId:       text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider:     varchar("provider", { length: 16 }).notNull(),
    // provider: "waffo" (web; "stripe" retired) | "wechat_pay" | "apple_iap" | "google_play" | "revenuecat"
    productId:    varchar("product_id", { length: 64 }).notNull(),  // SKU id
    providerRef:  varchar("provider_ref", { length: 128 }).notNull(),  // provider's transaction id
    amountCents:  integer("amount_cents").notNull(),
    currency:     varchar("currency", { length: 8 }).notNull(),       // "USD" | "CNY"
    notesGranted: integer("notes_granted").notNull(),
    status:       varchar("status", { length: 16 }).notNull(),
    // status: "pending" | "succeeded" | "refunded" | "failed"
    rawPayload:   jsonb("raw_payload"),
    createdAt:    timestamp("created_at").notNull().defaultNow(),
    updatedAt:    timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueProviderRef: uniqueIndex("purchases_provider_ref_idx").on(t.provider, t.providerRef),
    byUser:            index("purchases_user_idx").on(t.userId, t.createdAt),
    byStatus:          index("purchases_status_idx").on(t.status),
  }),
);
```

Lifecycle:

- `pending` on prepay (Waffo checkout init, WeChat unified order).
- `succeeded` after webhook verification + ledger grant insert.
- `refunded` after refund webhook + matching negative ledger row.
- `failed` after provider error event.

The live web write path (Waffo `order.completed` → `purchases` +
`notes_ledger`) is documented in [billing-waffo.md](billing-waffo.md).

### 3.6 `songs` (extended)

Current shape in
[songs.ts](../src/lib/db/schema/songs.ts). v2
changes:

```ts
mp3DataUrl: text("mp3_data_url"),       // DEPRECATED — read-only fallback for legacy rows
mp3Url:     text("mp3_url"),            // NEW: object-storage URL (R2 / S3 / 腾讯云 COS)
melody:     jsonb("melody").$type<CleanMelody>(),  // NEW: durable melody so playback fidelity survives
arrangementVersion: integer("arrangement_version").notNull().default(2),
posterUrl:  text("poster_url"),         // NEW: optional rendered PNG; v3 wires it
shareHtmlUrl: text("share_html_url"),   // NEW: optional rendered HTML
```

Constraints + migration:

- `arrangementVersion` is the schema version of `arrangementState +
  visualConfig + melody`. v1 rows are `1`; new rows are `2`.
- Playback code branches on `arrangementVersion`. v1 fallback already
  works (today's code); v2 uses `melody` for high-fidelity replay.
- Backfill (§v2-0007): for existing rows with `mp3DataUrl`, leave
  `mp3Url` null; the next user open transparently re-uploads the data
  URL to object storage and updates the row. (Background batch job
  optional.)

**Priority bump (`@research-2026-06` §7):** the `mp3DataUrl` removal
moves from "v2 mid-cycle" to a **Phase 4 hard requirement** — it must
land *with* billing, not after. Reasons:

- Even at 100 users × 10 songs × ~200 KB the column is 200 MB of
  Postgres BLOB. `pg_dump`, replication lag, and per-card gallery
  reads all scale poorly with this.
- The cost economics flip hard at egress scale: R2 / 腾讯云 COS are
  built for this, Postgres TEXT columns are not. R2 is **$0.015/GB
  stored, $0 egress**; S3 / COS are ~$0.023/GB + $0.09/GB egress
  (10 TB egress = $914 on S3 vs $0 on R2).
- The Capacitor shell (Phase 6) replays the user's own songs often;
  serving those bytes from the DB tier is the wrong default by then.

Vendor pick: **R2 for international, 腾讯云 COS for China.** Both
S3-compatible enough to share a single `objectStore.put(...)` adapter
behind a region flag.

Indexes:

- `songs_user_id_idx ON (user_id, created_at DESC)` (already present
  in effect; verify).

### 3.7 `events_webhook` (NEW)

```ts
export const eventsWebhook = pgTable(
  "events_webhook",
  {
    id:          text("id").primaryKey(),  // ulid `evw_…`
    provider:    varchar("provider", { length: 16 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 128 }).notNull(),
    routeId:     varchar("route_id", { length: 64 }).notNull(),  // e.g. "billing.webhook.waffo"
    receivedAt:  timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
    status:      varchar("status", { length: 16 }).notNull(),
    // status: "received" | "processed" | "failed" | "duplicate"
    signatureOk: boolean("signature_ok").notNull(),
    rawPayload:  jsonb("raw_payload").notNull(),
    error:       text("error"),
  },
  (t) => ({
    uniqueEvent: uniqueIndex("events_webhook_provider_event_idx").on(t.provider, t.providerEventId),
    byStatus:    index("events_webhook_status_idx").on(t.status, t.receivedAt),
  }),
);
```

Used by every webhook route (`api-conventions.md` §10). Hard-deleted
after 90 days by a retention job.

### 3.8 `audit_events` (OPTIONAL; postpone if backed externally)

If Codex backs the `memory.reportAction` adapter with Postgres rather
than Clickhouse, this table exists:

```ts
export const auditEvents = pgTable(
  "audit_events",
  {
    id:         text("id").primaryKey(),  // ulid `aud_…`
    userId:     text("user_id"),
    sessionId:  text("session_id"),
    shell:      varchar("shell", { length: 16 }).notNull(),
    page:       varchar("page", { length: 48 }).notNull(),
    eventType:  varchar("event_type", { length: 64 }).notNull(),
    metadata:   jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => ({
    byUser:    index("audit_user_idx").on(t.userId, t.occurredAt),
    byEvent:   index("audit_event_idx").on(t.eventType, t.occurredAt),
  }),
);
```

Codex picks Postgres for v2 and migrates to Clickhouse only when row
counts demand. Retention: 180 days, downsample weekly to a slim
aggregate table.

### 3.9 `rate_limits` (OPTIONAL; Redis preferred)

If Codex runs without Redis, fall back to:

```ts
export const rateLimits = pgTable(
  "rate_limits",
  {
    bucketKey:  varchar("bucket_key", { length: 96 }).primaryKey(), // "<userId>:<route>:<minute>"
    counter:    integer("counter").notNull().default(0),
    expiresAt:  timestamp("expires_at").notNull(),
  },
);
```

Worse than Redis in every way but ships. Retire when Redis lands.

---

## 4. Composite invariants

Across tables:

1. `sum(notes_ledger.delta WHERE user_id = U) == users.notes_balance` —
   enforced by the spend/grant helpers; verified nightly.
2. `purchases.status = "succeeded"` implies exactly one
   `notes_ledger.reason = "purchase:topup"` row with matching
   `externalRef = purchases.providerRef` (Waffo `orderId` on web).
   `purchases.status = "refunded"` implies a matching `refund:topup`
   ledger row keyed by the provider refund event or, if unavailable, the
   provider order id.
3. Every `users` row has ≥1 `external_identities` row (post-bind) or
   none (guest); guests never have one.
4. `sessions.user_id` points at a row whose `deleted_at IS NULL` at
   issuance time. Deletion cascades revoke sessions.
5. `songs.user_id` always points at a real (possibly soft-deleted)
   user. Hard user-delete cascades; soft-delete does not — songs of
   a tombstoned user are deleted by the 30-day purge job.

A pg_dump → restore should preserve all five. Codex writes a
`scripts/db-invariants.ts` that asserts them and runs nightly.

---

## 5. JSONB fields — typed contracts

JSONB is convenient but easy to drift. Each one has a typed contract
that lives in `packages/murmur-core/src/shared-types/`.

| Table.column | Type | Where defined |
|---|---|---|
| `users.consents` | `Consents` | `auth/consents.ts` |
| `songs.visualConfig` | `VisualConfig` | `shared-types/visual-config.ts` |
| `songs.arrangementState` | `ArrangementState` | `shared-types/arrangement.ts` |
| `songs.melody` | `CleanMelody` | `shared-types/melody.ts` |
| `notes_ledger.metadata` | `Record<string, unknown>` | n/a (free-form) |
| `purchases.rawPayload` | provider event | n/a |
| `events_webhook.rawPayload` | provider event | n/a |
| `audit_events.metadata` | `Record<string, unknown>` | n/a |

A test fixture asserts the JSON shape matches the TS type on insert.

---

## 6. Query helpers

Every table gets a `queries/<entity>.ts` with at least:

```ts
get<Entity>ById(id)
list<Entity>sBy<Owner>(ownerId, { limit, cursor })
create<Entity>(data)        // when applicable
update<Entity>(id, patch)   // when applicable
delete<Entity>(id)          // when applicable
```

…and a small number of business-specific helpers
(`spendNotes`, `grantDailyFree`, `revokeAllSessions`, …) that compose
the basics inside transactions.

Queries do **not** spread across route files. A route imports a query;
it does not write Drizzle directly. Reason: testability + reuse.

---

## 7. Cascades + delete semantics

| When | What cascades |
|---|---|
| `users.deletedAt = now()` (soft) | nothing immediately; a 30-day job hard-deletes. Sessions are revoked synchronously. |
| `DELETE FROM users` (hard) | `external_identities` (cascade), `sessions` (cascade), `songs` (cascade), `notes_ledger` (cascade), `purchases` (cascade) |
| `DELETE FROM songs` | nothing — songs are leaves |
| `DELETE FROM sessions` | nothing |
| `DELETE FROM purchases` | nothing (refund logic adjusts the ledger; no row mutation) |

The user-driven account-delete pathway uses soft-delete, then the job
runs the hard delete. This satisfies App Store + WeChat + PIPL retention
norms.

---

## 8. Object storage (not a table, but in scope)

- Bucket `murmur-songs` for `mp3Url`, `posterUrl`, `shareHtmlUrl`.
- Path: `songs/{userId}/{songId}.mp3`.
- Signed PUT URLs expire in 10 minutes.
- Public read via signed-URL CDN; no anonymous public read.
- Lifecycle: when `songs` row is hard-deleted, a Cloud Function /
  background job deletes the object. The DB does not own the object's
  lifetime directly.

Provider: R2 (intl) + 腾讯云 COS (cn). Region routed by
`users.regionId`.

---

## 9. Acceptance criteria

A downstream agent has shipped the v2 data model when:

- [ ] All ten migrations in §2 apply cleanly on a fresh DB and roll
      back cleanly.
- [ ] All composite invariants (§4) hold after a seed-data run + a
      smoke test of the audio + payment flows.
- [ ] No reads happen without going through a `queries/*.ts` helper.
- [ ] `spendNotes` is the only place `users.notesBalance` is mutated
      in app code.
- [ ] The legacy `mp3DataUrl` column is read-only (no new writes); a
      lint rule flags `INSERT … mp3_data_url` in code review.
- [ ] `scripts/db-invariants.ts` runs nightly and pages on failure.

---

## 10. What this model deliberately leaves out

- `playlists`, `tags`, `comments`, `follows` — v3.
- `subscriptions` — v3 (the `purchases` schema is forward-compatible).
- `teams`, `orgs` — never (or v∞).
- `embeddings` for songs / melodies — v3 if recommendation work
  starts.
- Anything specific to Capacitor / MP push tokens — `notifications` is
  still a stub; the table arrives with the publisher.

Sibling docs: `user-model.md`, `payment-topup-feature.md`,
`audio-pipeline-redesign.md`, `api-conventions.md`,
`observability.md`.
