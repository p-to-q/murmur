# Payment + Top-up — Feature Spec

## 1. Goal

Murmur v2 must support paid features. The user named two new screens:
**支付页 (Payment)** and **充值页 (Top-up)**. This document specifies the
data model, the user-visible surface, and the cross-platform integration
points so a downstream agent can implement without re-deciding.

Pair this with `cross-platform-strategy.md` §9 — the payment provider per
shell is decided there; this doc specifies the product.

## 2. Decision: credits, not subscription (v2)

Two viable models:

| Model | Pros | Cons |
|---|---|---|
| Subscription (Premium / Free) | predictable revenue, simpler entitlement | App Store + 微信 friction; users resist recurring for a side-app |
| **Credits ("Murmur Notes")** | low commitment, "pay for what you make," easy WeChat MP fit | irregular revenue, must explain "what costs" |

**Recommend credits for v2.** Reasons:

- Matches the product's actual cost surface: every generation costs us
  audio worker CPU + (optionally) LLM tokens.
- Compatible with WeChat MP's culture (single-purchase >> subscription).
- App Store + Play Store treat consumable IAP as the simplest review path.
- We can re-introduce subscription later as a "Premium = unlimited notes
  + advanced features" tier without breaking the credit model.

A user has a **credit balance** (`notes` integer). Each chargeable action
debits that balance. Top-up restores it. Free tier gives a daily refill.

## 3. What costs

| Action | Cost (notes) | Why |
|---|---|---|
| Hum → ScoredMelody | 1 | server audio worker CPU |
| Generate 3 vibe versions | 0 | runs client / arrangement engine |
| Studio LLM edit (Auris) | 1 / call | OpenAI cost passthrough |
| Save song (persistence + render) | 1 | storage + MP3 render |
| Export WebM (audio + video) | 2 | longer render |
| Export poster PNG | 0 | client-side render |
| Export share HTML | 0 | client-side render |

Free tier daily allowance:

- **5 notes per day** auto-refill at server time `00:00 +08:00`.
- Cap: max 10 unused free notes (incentivizes use, not hoarding).

This gives a free user roughly: 1 new hum + 1 save + 1 LLM edit + 1 spare
per day. Enough to feel the product; not enough to abuse the LLM endpoint.

## 4. Data model

### 4.1 Schema additions

Add to [users.ts](../src/lib/db/schema/users.ts):

```ts
// users table additions
notesBalance:      integer("notes_balance").notNull().default(5),
freeNotesGrantedAt: timestamp("free_notes_granted_at").notNull().defaultNow(),
planTier:          varchar("plan_tier", { length: 32 }).notNull().default("free"),  // free | premium (reserved)
regionId:          varchar("region_id", { length: 16 }).notNull().default("intl"),  // intl | cn
```

New tables:

```ts
// src/lib/db/schema/notes-ledger.ts
export const notesLedger = pgTable("notes_ledger", {
  id:        text("id").primaryKey(),         // ulid
  userId:    text("user_id").notNull(),
  delta:     integer("delta").notNull(),      // negative for spend, positive for grant/purchase
  reason:    varchar("reason", { length: 32 }).notNull(),
  // reason values: "spend:hum" | "spend:llm_edit" | "spend:save" | "spend:export_webm"
  //                "grant:daily_free" | "grant:signup_bonus" | "purchase:topup"
  externalRef: text("external_ref"),          // Stripe payment_intent_id, WeChat transaction_id, RevenueCat tx id…
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// src/lib/db/schema/purchases.ts
export const purchases = pgTable("purchases", {
  id:           text("id").primaryKey(),
  userId:       text("user_id").notNull(),
  provider:     varchar("provider", { length: 32 }).notNull(),
  // provider: "stripe" | "wechat_pay" | "apple_iap" | "google_play" | "revenuecat"
  productId:    varchar("product_id", { length: 64 }).notNull(),
  // product id of the SKU bought (e.g. "topup_30_notes")
  amountCents:  integer("amount_cents").notNull(),       // store in smallest unit (cents / 分)
  currency:     varchar("currency", { length: 8 }).notNull(),  // "USD" | "CNY"
  notesGranted: integer("notes_granted").notNull(),
  status:       varchar("status", { length: 16 }).notNull(),
  // status: "pending" | "succeeded" | "refunded" | "failed"
  rawPayload:   jsonb("raw_payload"),                  // provider webhook body
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});
```

The **ledger is the source of truth**. `users.notesBalance` is a
materialized view kept in sync inside a transaction. Every grant / spend
writes a ledger row + updates the balance atomically. Refunds insert a
negative grant rather than mutating prior rows.

### 4.2 SKUs (initial)

| SKU id | Notes | USD | CNY (≈) | Comment |
|---|---|---|---|---|
| `topup_30_notes` | 30 | $1.99 | ¥12 | starter |
| `topup_120_notes` | 120 | $5.99 | ¥38 | popular |
| `topup_400_notes` | 400 | $14.99 | ¥98 | best value |

Prices, not the structure, are tunable from a server-side config table.
**Do not hardcode prices in client code** — they need region-specific
display rules (App Store tiers, ¥-rounded WeChat tiers).

## 5. User-visible surfaces

### 5.1 充值页 (TopupScreen) — `/topup`

```
┌────────────────────────────────────────┐
│  Header (back)                         │
│  "Murmur Notes"                        │
│                                        │
│  Current balance — large numerical     │
│  "12 notes"                            │
│  small caption — daily refill at 0:00  │
│                                        │
│  [Three SKU cards in bento layout]     │
│  ┌──────┐ ┌──────┐ ┌──────┐            │
│  │  30  │ │ 120 │ │ 400  │             │
│  │$1.99 │ │$5.99│ │$14.99│             │
│  └──────┘ └──────┘ └──────┘            │
│                                        │
│  Provider chip row                     │
│   (auto-selected by shell)             │
│                                        │
│  CTA — "Buy notes"                     │
│                                        │
│  Restore purchases (iOS / Android only)│
│  Terms · Privacy                       │
└────────────────────────────────────────┘
```

### 5.2 支付页 (PaymentScreen) — `/topup/checkout`

This is the **provider-handoff** screen, not a checkout itself.

- Web shell: redirects to Stripe Checkout (or WeChat Pay JSAPI flow).
- iOS / Android shell: triggers native sheet via RevenueCat, never
  navigates away.
- 微信 MP shell: invokes `wx.requestPayment` directly.

The unified UI element is a single state machine:

```
idle → requesting → succeeded   ← happy path
                 ↘ canceled    ← user dismissed
                 ↘ failed      ← provider error, show retry
```

On success, the client polls `GET /api/user/balance` once and reflects
the new balance. The actual ledger write happens via the **provider
webhook**, never client-triggered.

### 5.3 Where the user is reminded

- Save button on Studio: if `balance < cost.save`, button shows
  "Save (need 1 note) — Top up" instead of "Save."
- Hum CTA on HumScreen: gated only when `balance == 0`. Below zero never
  occurs; the API spends in a transaction that checks balance first.
- MeScreen: balance + "Top up" link at the top of the page (replace the
  current debug "runtime status" row described in
  `diagnosis-2026-06.md` §4).
- Gallery: no payment surface needed.

## 6. API surface

New routes (all in `src/app/api/`):

| Route | Method | Purpose |
|---|---|---|
| `/api/user/balance` | GET | returns `{ notes, planTier, nextRefillAt }` |
| `/api/billing/skus` | GET | returns SKU table for the requesting region |
| `/api/billing/checkout` | POST | create Stripe Checkout session (web only) |
| `/api/billing/wechat-prepay` | POST | create WeChat Pay JSAPI / MP order |
| `/api/billing/webhook/stripe` | POST | Stripe → ledger write |
| `/api/billing/webhook/wechat` | POST | WeChat → ledger write |
| `/api/billing/webhook/revenuecat` | POST | RevenueCat (App Store + Play) → ledger write |
| `/api/billing/refund` | POST | manual op-tool entry (internal) |

All chargeable routes (`/api/transcribe`, `/api/strummer/edit`,
`/api/songs`, `/api/export/webm`) gain a balance-check + ledger-write
transaction:

```ts
const ok = await spendNotes(userId, cost, "spend:hum");
if (!ok) return NextResponse.json({ error: "insufficient_notes" }, { status: 402 });
// proceed with the work
```

`402 Payment Required` is the new standard "need to top up" response. The
client maps it to a modal that links to `/topup`.

Current substrate shipped in Phase 4 pre-work:

- `GET /api/user/balance` exists.
- `notes_ledger` and `purchases` are registered and migrated.
- `POST /api/transcribe` checks balance and returns
  `402 insufficient_notes` before worker execution when the user lacks notes.
- Transcription spends `1` note only after a successful worker result, so
  no-voice and worker failures do not consume notes.
- `POST /api/strummer/edit` checks balance before the LLM call and spends
  `1` note only after a successful classifier response.
- `POST /api/songs` spends `1` note and inserts the song in one transaction.

Carry-forward: top-up pages, checkout, SKU routes, webhooks, and refill cron
are still pending.

## 7. Cross-platform integration (recap)

| Shell | Web flow | Native flow |
|---|---|---|
| Web (intl) | Stripe Checkout (Card / Link / Apple Pay web) | n/a |
| Web (CN) | WeChat Pay JSAPI (`MWEB` flow) | n/a |
| Capacitor iOS | n/a | StoreKit IAP via RevenueCat |
| Capacitor Android | n/a | Google Play Billing via RevenueCat |
| 微信 MP | `wx.requestPayment` (WeChat Pay MP API) | (same) |

**RevenueCat** is the recommended abstraction for iOS + Android. It:

- Owns SKU sync with App Store Connect + Play Console.
- Webhooks into our backend on every event.
- Handles introductory offers / restore purchases without per-store code.

We **cannot** route iOS digital-good purchases through Stripe — App Store
review forbids it. The Web SKUs and the IAP SKUs may have **different
prices** because of Apple's 15-30% cut; honor each store's price card,
keep the credit grant identical.

WeChat Pay (web + MP) is wired without RevenueCat. The webhook signature
verification follows
[WeChat Pay v3](https://pay.weixin.qq.com/doc/global/v2/en/4013664934).

### 7.1 RevenueCat + Capacitor — hard requirements (`@research-2026-06` §6)

Two failure modes are documented in the RevenueCat Capacitor / iOS issue
trackers and **must** be defended against in code, not just at review time:

1. **The Promise can hang forever.** `Purchases.purchasePackage`,
   `Purchases.purchaseStoreProduct`, `Purchases.getOfferings`, and
   `Purchases.getCustomerInfo` are documented as never resolving in
   several reproducible cases — Vue/Svelte reactive proxies passed in
   without `toRaw()`, misconfigured native side, and offline cold start
   with no cached `CustomerInfo`. RevenueCat does not apply a default
   timeout.
   - All RevenueCat calls live behind a `withTimeout(promise, 8000)`
     helper. Timeout surfaces a `provider_timeout` BillingError; the
     Checkout state machine offers retry.
2. **Object-identity bugs from framework proxies.** Murmur uses Zustand
   (no reactive proxies wrapping plain objects), so the canonical bite
   path is unlikely, but each SKU object handed to RevenueCat passes
   through `structuredClone()` first as a future-proofing guard.

Operational practice:

- Bundle a `storekit_config.storekit` file in the Capacitor iOS scaffold
  for sandbox testing. Without it, `purchasePackage` will hang on
  simulator.
- Verify Google Play service-account credentials JSON is uploaded to
  the RevenueCat dashboard before any internal-track test. A configure
  return of `-1` on Android typically points to this gap.
- Treat the first `getCustomerInfo` after install as the highest-risk
  call; it has the most "never resolves" failures because it has no
  cache to fall back to.

Sources: `github.com/RevenueCat/purchases-capacitor/issues/279`,
`github.com/RevenueCat/purchases-ios/issues/4931`,
`github.com/RevenueCat/purchases-capacitor/issues/282`.

## 8. Daily free refill

Background job (cron or scheduled task):

```ts
// runs hourly; idempotent
for users where freeNotesGrantedAt < startOfToday(user.regionId):
  grant min(5, 10 - currentBalance)
  set freeNotesGrantedAt = startOfToday(user.regionId)
```

Worth noting: Murmur already has a daily-digest cron stub at
`/api/notifications/cron/daily-digest` — reuse the same scheduler.

## 9. Anti-abuse

- Server-side rate limits per IP + per userId for unauthenticated /
  guest users.
- Webhook signature verification mandatory (Stripe, WeChat, RevenueCat).
- All ledger writes scoped to a single SQL transaction with
  `SELECT ... FOR UPDATE` on the user row.
- Refunds never delete ledger rows; they insert negative grants and a
  matching `purchases.status = "refunded"` flip.
- Don't trust the client's claim of which SKU was bought — read the
  provider's confirmation.

## 10. Acceptance criteria

A downstream agent has shipped payment + top-up when:

- [ ] `users.notesBalance` + `notesLedger` + `purchases` tables exist
      and are migrated.
- [ ] `/topup` and `/topup/checkout` routes exist on the web shell.
- [ ] Stripe webhook → balance increment works end-to-end with at least
      one real test purchase in Stripe sandbox.
- [ ] `/api/transcribe`, `/api/strummer/edit`, `/api/songs` POST all
      respect `402` on insufficient balance and never write business
      output without ledger consumption.
- [ ] Daily free refill cron actually runs and grants notes.
- [ ] MeScreen surfaces balance + "Top up" link.
- [ ] Studio Save button reflects gating when balance < 1.
- [ ] Restore purchases works on iOS (via RevenueCat) — checked manually
      in TestFlight before release.
- [ ] Every RevenueCat call is wrapped in `withTimeout(8000)` and
      surfaces `provider_timeout` on cold-start with no cached customer.
- [ ] Sandbox / Internal-track purchase succeeds end-to-end on both
      iOS Simulator (with `storekit_config.storekit`) and an Android
      internal-track build (with service-account JSON uploaded to
      RevenueCat).
- [ ] 微信 MP-region launch is gated on ICP + 网文证 (or counsel-cleared
      工具 / 创作辅助 classification) per `cross-platform-strategy.md` §4.3.a.

## 11. Out of scope (v2)

- Subscription tier (premium / pro).
- Gifting between users.
- Discount codes / coupons.
- Family / team accounts.
- Auto-spend caps / "stop me when balance hits N" affordance.
- Crypto / stablecoin payment.

## 12. Open questions

1. Free-tier abuse: should we tie `notesBalance` to a verified phone
   number / Apple ID / WeChat openid before granting first 5 notes? Yes
   on iOS (sign in with Apple) + MP (openid is automatic); web stays
   guest-allowed for now.
2. SKU price card per region — do we maintain in code or via an admin
   console? Recommend in DB + a tiny `/admin/billing` page in week 4.
3. Pre-launch credit gift to existing users so we don't break their
   flow. Recommend granting 50 notes to all users on the v2 cutover
   commit; documented in the migration.

Sibling: `cross-platform-strategy.md`, `audio-pipeline-redesign.md`,
`execution-roadmap.md`.
