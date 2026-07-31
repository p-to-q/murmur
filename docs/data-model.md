# Data Model

The authoritative list of every Postgres table Murmur ships in v2.
This is the file Codex reads when generating a Drizzle schema,
authoring a migration, or writing a query. If a table is not here, it
does not exist; if a field is not here, it does not exist.

Behavioral semantics for each table live in the feature docs
(`user-model.md`, `payment-topup-feature.md`,
`audio-pipeline-redesign.md`); this file is the **shape**, plus the
constraints, indexes, and migration order.

For the analysis/training retrieval shape that ties users, composition
artifacts, lineage, notes, purchases, and feedback-adjacent events together, see
[user-composition-data-contract.md](user-composition-data-contract.md).

---

## 1. Conventions

- All tables live in `src/lib/db/schema/<entity>.ts`.
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
v2-0009  share-referrals       (invite-link attribution)
v2-0010  rate-limits           (shared production token buckets)
v2-0011  audit-events          (optional; clickhouse preferred)
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
dailyFreeNotesBalance: integer("daily_free_notes_balance").notNull().default(0),
freeNotesGrantedAt: timestamp("free_notes_granted_at").notNull().defaultNow(),
planTier:           varchar("plan_tier", { length: 16 }).notNull().default("free"),
regionId:           varchar("region_id", { length: 8 }).notNull().default("intl"),
accountKind:        varchar("account_kind", { length: 32 }).notNull().default("registered"),
promotedAt:         timestamp("promoted_at"),
deletedAt:          timestamp("deleted_at"),
consents:           jsonb("consents").$type<Consents>().notNull().default(sql`'{"termsAcceptedAt":null,"privacyAcceptedAt":null,"pipl":null,"marketingOptIn":false}'`),
```

Constraints:

- `planTier IN ("free", "premium")`.
- `regionId IN ("intl", "cn")`.
- `accountKind IN ("local_creator", "registered")`.
- `notesBalance` may be negative after a provider refund reverses notes the
  user already spent; the negative value is billing debt, not spendable balance.
- Operation delivery settlement itself never creates new debt: when a prior
  failed-work refund needs to be re-charged but the current balance is too low,
  the verified result remains recoverable and delivery returns
  `insufficient_notes` until balance is available.
- `dailyFreeNotesBalance >= 0` and `dailyFreeNotesBalance <= max(notesBalance, 0)`
  (enforced in app).

Indexes (in addition to existing email + createdAt):

- `users_plan_tier_idx ON (plan_tier)`
- `users_region_id_idx ON (region_id)`
- `users_account_kind_idx ON (account_kind)`
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
    userId:     varchar("user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    provider:   varchar("provider", { length: 16 }).notNull(),
    // provider: "apple" | "google" | "github" | "wechat" | "wechat_mp" | "email"
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
- `user_id → users.id` is a real Postgres FK with `ON DELETE cascade`.

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

### 3.4 `push_subscriptions`

[push-subscriptions.ts](../src/lib/db/schema/push-subscriptions.ts): browser
Web Push subscriptions for OS-level notifications.

Important fields:

- `user_id → users.id` — subscriptions are account-scoped and cascade on hard
  delete.
- `session_id` — required for new subscriptions and bound by composite foreign
  key to the owning persistent web session. Legacy OAuth subscriptions may
  temporarily retain null until that browser adopts and rebinds a Murmur
  session.
- `endpoint` — unique push service endpoint; upserts move a browser
  subscription to the latest signed-in user.
- `p256dh`, `auth` — Web Push encryption keys.
- `shell` — currently `web`; native shells should use their own token tables
  or extend this only after a platform decision.
- `metadata` — small client hints such as locale and timezone.
- `disabled_at` — set when the user turns browser alerts off or a push service
  returns 404/410.

Indexes:

- `push_subscriptions_user_idx ON (user_id)`
- `push_subscriptions_active_user_idx ON (user_id, disabled_at)`
- `push_subscriptions_endpoint_idx ON (endpoint)` — unique
- `push_subscriptions_active_session_idx ON (session_id) WHERE disabled_at IS NULL`
- `sessions_id_user_idx ON (id, user_id)` — supports the composite session-owner
  foreign key used by active Push rows

New subscriptions must reference the owning, unrevoked, unexpired persistent
session. Subscription writes lock that session row, logout revokes and disables
under the same boundary, delivery queries join the active session, and endpoint
`expiration_time` is enforced. Migration `0032` disables expired, revoked, and
orphan bound rows and adds session ownership without disabling legacy
null-session rows. Those legacy rows are not deliverable; OAuth adoption asks
the current browser to rebind its endpoint, and release preflight reports the
remaining count. A later migration may enforce non-null active sessions only
after production evidence shows the legacy count has converged to zero.

### 3.5 `notes_ledger` (NEW)

```ts
export const notesLedger = pgTable(
  "notes_ledger",
  {
    id:          text("id").primaryKey(),                   // ulid `nle_…`
    userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    delta:       integer("delta").notNull(),                // signed
    reason:      varchar("reason", { length: 32 }).notNull(),
    // reason taxonomy:
    //   "spend:hum" | "spend:music_generate" | "spend:llm_edit" | "spend:save" | "spend:export_webm"
    //   "grant:daily_free" | "grant:signup_bonus" | "grant:cutover_gift" | "grant:referral" | "grant:local_creator"
    //   "purchase:topup" | "refund:topup" | "refund:spend" | "manual:op_grant"
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
- `dailyFreeNotesBalance` is the unspent daily-free portion of
  positive `notesBalance`; account-pool display derives as
  `max(notesBalance, 0) - dailyFreeNotesBalance`.
- No row is ever updated or deleted. Provider top-up refunds insert a
  full negative `refund:topup` row keyed by the provider refund event; if the
  user has already spent those notes, `users.notesBalance` goes negative until
  future grants/top-ups repay the debt. Failed-spend refunds insert a positive
  `refund:spend` row keyed by the original spend.
- Every business action that consumes or grants notes inserts exactly
  one ledger row inside the same SQL transaction as the action itself.
- `spendNotes` consumes daily-free notes first, then account notes. Spend
  metadata records the pool split so failed-spend refunds can restore the
  daily-free portion.

Helper in `src/lib/db/queries/notes-ledger.ts`:

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

#### Transcription operation receipts

`transcription_operations` binds a stable `(user_id, operation_id)` to the
SHA-256 of the uploaded audio plus target instrument, the original Hum spend,
the final `TranscriptionResult`, and a fenced processing lease. Status moves
through `processing -> result_ready -> succeeded`; worker failure moves the
same lease epoch to `retryable` while atomically recording pending-refund
intent. Exact retries recover `result_ready`/`succeeded` without calling the
Worker, while an id reused with different input returns `409`.

The receipt and spend are created in one user-row-locked transaction. A legacy
`hum:op:*` spend without a matching receipt has no verifiable audio hash, so it
is rejected as an idempotency conflict rather than silently attached to new
input. Settlement happens after the result is durable. If re-charging a prior
refund requires unavailable balance, the result remains `result_ready` and no
delivered marker or negative balance is written.

### 3.5 `share_referrals` (NEW)

```ts
export const shareReferrals = pgTable(
  "share_referrals",
  {
    id:               text("id").primaryKey(),
    referrerUserId:   text("referrer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    inviteeUserId:    text("invitee_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status:           varchar("status", { length: 16 }).notNull().default("settled"),
    source:           varchar("source", { length: 32 }).notNull(),
    registrationKind: varchar("registration_kind", { length: 32 }).notNull(),
    rewardNotes:      integer("reward_notes").notNull(),
    referrerLedgerId: text("referrer_ledger_id").notNull(),
    inviteeLedgerId:  text("invitee_ledger_id").notNull(),
    metadata:         jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    createdAt:        timestamp("created_at").notNull().defaultNow(),
    settledAt:        timestamp("settled_at"),
  },
  (t) => ({
    byReferrer:    index("share_referrals_referrer_idx").on(t.referrerUserId, t.createdAt),
    byStatus:      index("share_referrals_status_idx").on(t.status, t.createdAt),
    uniqueInvitee: uniqueIndex("share_referrals_invitee_idx").on(t.inviteeUserId),
  }),
);
```

Referral rewards settle only during a new registration or Local Creator ->
registered promotion. Existing registered users who later open a `?ref=` link
cannot create a referral reward. The notes ledger remains the balance audit
trail; this table records product attribution, enforces one settled referrer per
invitee, and stores the ledger row ids created in the same transaction.

### 3.6 `purchases` (NEW)

```ts
export const purchases = pgTable(
  "purchases",
  {
    id:           text("id").primaryKey(),               // ulid `pur_…`
    userId:       text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider:     varchar("provider", { length: 16 }).notNull(),
    // provider: "waffo" (web; "stripe" retired) | "wechat_pay" | "apple_iap" | "google_play" | "revenuecat"
    productId:    varchar("product_id", { length: 64 }).notNull(),  // SKU id
    providerRef:  varchar("provider_ref", { length: 128 }).notNull(),
    // Provider transaction id. Waffo pending rows temporarily use Murmur's
    // orderMerchantExternalId, then switch to the final orderId on success.
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

- `pending` on prepay (Waffo checkout init, WeChat unified order). Waffo stores
  the checkout-generated `waffo-pending:pur_…` merchant reference in
  `providerRef` together with the authoritative amount/grant snapshot.
- `succeeded` after webhook verification + snapshot validation + ledger grant
  insert. The same Waffo row switches `providerRef` to the final `orderId` in
  that transaction; no extra correlation column is required.
- `refunded` after refund webhook + matching negative ledger row.
- `failed` after provider error event.

The live web write path (Waffo `order.completed` → `purchases` +
`notes_ledger`) is documented in [billing-waffo.md](billing-waffo.md).

### 3.7 `songs` (extended)

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
visibility: text("visibility").notNull().default("private"), // private | unlisted | public
shareCode:  text("share_code"),         // opaque public playback code for /s/[shareCode]
```

Constraints + migration:

- `arrangementVersion` is the schema version of `arrangementState +
  visualConfig + melody`. v1 rows are `1`; new rows are `2`.
- Playback code branches on `arrangementVersion`. v1 fallback already
  works (today's code); v2 uses `melody` for high-fidelity replay.
- `visibility` has three product states:
  - `private`: owner-only. This is the default for all saved songs.
  - `unlisted`: link-accessible through `/s/[shareCode]`, excluded from
    search, community feeds, and crawler indexing.
  - `public`: link-accessible and eligible for future search/community
    surfaces. The community UI is not live yet; this state exists so the
    backend contract does not need to change later.
- `shareCode` is an opaque, non-sequential 10-character code. It is unique
  when present and is allocated only through `POST /api/songs/[id]/share`.
  It is not the primary key and must not be treated as owner identity.
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
- `songs_share_code_idx ON (share_code) WHERE share_code IS NOT NULL`.
- `songs_visibility_idx ON (visibility, updated_at)`.
- `songs_public_search_idx ON (visibility, created_at DESC) WHERE
  visibility = 'public'` is the minimal future community/search affordance.

Current share-link notes:

- `/s/[shareCode]` is the public playback surface. It should not expose
  owner-only fields, arrangement internals, billing state, or delete/edit
  controls.
- Unlisted responses send `X-Robots-Tag: noindex, nofollow` and avoid shared
  caches. Public responses can use short shared caching.
- Demo songs use deterministic share codes (`demo-1`, `demo-2`, `demo-3`) for
  local QA, but generated user share codes intentionally do not use that shape.
- Until object storage is fully rolled out, public playback may still return
  `mp3DataUrl` for legacy rows. That is acceptable for the demo path but should
  be treated as a temporary compatibility path, not the long-term public-share
  transport.

### 3.8 `events_webhook` (NEW)

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

### 3.9 `composition_events`

`composition_events` is the minimal durable index for Murmur's composition
training corpus. The song artifact remains the source of truth; this table
records product events that make the artifact searchable by user, draft,
generation batch, and lifecycle action.

Authoritative schema:
[composition-events.ts](../src/lib/db/schema/composition-events.ts).

Current event kinds:

- `generation.completed` — bounded Worker receipt, quality, candidate, runtime,
  timing, and cost evidence written after a successful synchronous or durable
  generation; raw hum audio and prompt text are excluded.
- `song.saved` — written by `POST /api/songs` after a successful DB save.
- `song.shared` — reserved for the share-link route.
- `song.exported` — reserved for audio/image/video export adapters.
- `song.feedback` — reserved for explicit user feedback on a song/version.

Important fields:

- `user_id` — owner identity. Cascades on hard user delete.
- `song_id` — saved artifact id. `ON DELETE SET NULL` keeps aggregate event
  history while removing the deleted song pointer.
- `draft_id` — client draft/session id from `songs.provenance.draftId`.
- `flow_id` — creation flow id from `VibeVersion.originFlowId` /
  `songs.provenance.flow`.
- `generation_batch_id` — sibling generation batch id, shared by the three
  Vibe candidates when available.
- `generation_clip_id` — the selected/generated clip operation id.
- `event_kind` — typed lifecycle action.
- `source` — writer surface, currently `server`; future values may include
  `client`, `worker`, or `admin`.
- `payload` — small, bounded metadata only. It should contain ids, status,
  model/version labels, error classes, and user feedback values, not raw audio
  or long free-form text.

Indexes:

- `composition_events_user_time_idx ON (user_id, occurred_at)`
- `composition_events_song_time_idx ON (song_id, occurred_at)`
- `composition_events_draft_time_idx ON (draft_id, occurred_at)`
- `composition_events_generation_batch_idx ON (generation_batch_id, occurred_at)`
- `composition_events_kind_time_idx ON (event_kind, occurred_at)`

Current writer:

- `POST /api/music/generate` writes bounded `generation.completed` evidence
  after the delivery Gate passes and before settlement or audio delivery. A
  transient event failure refunds the operation and returns a retryable error;
  retrying the same clip identity cannot double-charge the user.
- The durable music runner records the same event before changing
  `result_ready` to `succeeded`. Its stable job-derived event id makes retries
  idempotent; an event-write failure leaves the job retryable instead of losing
  evidence after a terminal transition. Concurrent pollers cannot emit
  duplicates, and `music_jobs.output` remains the durable result source.
- `POST /api/songs` schedules a best-effort `song.saved` event after successful
  persistence. Event write failures are logged as
  `composition_event.write_failed` and do not block the user's save.

Query/export helper:

- `listCompositionTrainingExamples` in
  [composition-events.ts](../src/lib/db/queries/composition-events.ts)
  returns one row per saved song with the attached event sequence.
- Filters: `userId`, `songId`, `draftId`, `generationBatchId`, `from`, `to`,
  `limit`.

Export shape:

```ts
type CompositionTrainingExample = {
  userId: string;
  songId: string;
  draftId: string | null;
  flowId: string | null;
  generationBatchId: string | null;
  generationClipId: string | null;
  generationAudioSha256: string | null;
  generationLinkTrust: "user_asserted_server_verified" | null;
  sourceType: string | null;
  sourceMelodyKind: "intent" | "corrected" | "musical";
  lineage: {
    parentSongId: string | null;
    rootSongId: string | null;
    depth: number;
    editCount: number;
    editDepth: "fresh" | "shaped" | "reworked";
  };
  artifact: {
    version: number;
    title: string;
    vibe: string;
    vibeEn: string;
    bpm: number;
    keySignature: string;
    scaleType: string;
    duration: number;
    tags: string[];
    melody: CleanMelody | null;
    arrangementState: ArrangementState;
    visualConfig: VisualConfig;
    hasAudio: boolean;
    mp3StorageKey: string | null;
    saveFingerprint: string | null;
  };
  events: Array<{
    id: string;
    kind: CompositionEventKind;
    source: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
};
```

Privacy and training-use notes:

- Treat `user_id`, `song_id`, `draft_id`, `flow_id`, generation ids, and
  storage keys as pseudonymous but still sensitive. Do not export them outside
  Murmur systems without a documented purpose and access control.
- Do not store raw hum audio in `composition_events.payload`. Raw or rendered
  audio belongs in object storage, referenced by `songs.mp3_storage_key`.
- Rendered song masters use unique incarnation keys containing song id, digest,
  and a fresh object id. Exact request retries converge through the song save
  transaction, while later saves never overwrite or silently reuse an older
  object's lifecycle identity.
- For training/model work, prefer an internal export job that joins these rows
  and replaces user ids with run-local pseudonyms before producing files.
- Honor account deletion: the 30-day purge removes composition events, songs,
  Worker jobs, identities, sessions, and creative objects. The user tombstone,
  purchases, and Notes ledger remain as restricted pseudonymous records for
  billing/refund audit. Stable user and provider references mean these records
  are not anonymous; they must not be exported as training data.
- `payload` must not contain payment provider payloads, email addresses,
  access tokens, IP addresses, or full user-agent strings.

### 3.10 `audit_events` (OPTIONAL; postpone if backed externally)

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

### 3.11 `rate_limits`

Production route-level rate limits use Postgres-backed token buckets by default
(`MURMUR_RATE_LIMIT_DRIVER=postgres`). Local development and tests keep the
process-local memory store unless explicitly configured. The table stores one
opaque bucket row per limiter key; callers own namespacing (`route:bucket:user`).

```ts
export const rateLimits = pgTable(
  "rate_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    tokens:    doublePrecision("tokens").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    expiresAtIdx: index("rate_limits_expires_at_idx").on(table.expiresAt),
  }),
);
```

`hit` and `refund` mutate each bucket inside a transaction and take a
per-bucket advisory lock, so multiple app instances converge on one shared
token count. `expires_at` is a cleanup hint for stale buckets and is indexed for
background or opportunistic deletion.

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
| `composition_events.payload` | `CompositionEventPayload` | `src/lib/db/schema/composition-events.ts` |
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
| `users.deletedAt = now()` (soft) | sessions and shares are revoked, Push is disabled, and a 30-day cleanup job is queued |
| account cleanup finalization | creative/identity rows and referenced objects are removed; a restricted pseudonymous user tombstone, purchases, and Notes ledger remain for billing/refund audit |
| `DELETE FROM users` (operator-only hard delete) | DB foreign-key cascades apply, including billing rows; this is not the user-facing deletion path |
| `DELETE FROM songs` | the audio-lifecycle trigger marks the referenced incarnation `delete_pending` |
| `DELETE FROM sessions` | nothing |
| `DELETE FROM purchases` | nothing (refund logic adjusts the ledger; no row mutation) |

The user-driven account-delete pathway uses immediate soft-delete/revocation,
then a leased cleanup job removes creative and identity data after 30 days.
There is no cancel/restore API in this release.

---

## 8. Object storage (not a table, but in scope)

- Production uses the configured S3-compatible bucket through
  `src/lib/storage/`; storage credentials never reach clients.
- Saved masters use
  `songs/master/{userId}/{songId}/{digest}_{incarnationId}.{ext}`. Postgres
  `song_audio_objects` receipts own pending, committed, delete-pending, retry,
  and deleted lifecycle state.
- Owner and public-capability API routes re-authorize and stream validated
  bytes with HEAD/Range/ETag support. Direct anonymous access is disabled only
  after the documented private-write rollout becomes the rollback baseline.
- Raw hums for durable jobs live under `tmp/` with a 24-hour TTL. Production
  release requires verified bucket lifecycle enforcement because adapter TTL
  metadata alone does not delete S3 objects.
- Durable music-job output lives under `music/jobs/` until song/account
  lifecycle cleanup removes it.

---

## 9. Acceptance criteria

A downstream agent has shipped the v2 data model when:

- [ ] All ten migrations in §2 apply cleanly on a fresh DB and roll
      back cleanly.
- [ ] All composite invariants (§4) hold after a seed-data run + a
      smoke test of the audio + payment flows.
- [ ] No reads happen without going through a `queries/*.ts` helper.
- [ ] `spendNotes`, `grantNotes`, top-up reversal, and daily-free refill
      are the only app helpers that mutate note balances.
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
- Anything specific to Capacitor / MP push tokens — Web Push covers the web
  shell; native push tokens should arrive with the native shell adapter.

Sibling docs: `user-model.md`, `payment-topup-feature.md`,
`audio-pipeline-redesign.md`, `api-conventions.md`,
`observability.md`.
