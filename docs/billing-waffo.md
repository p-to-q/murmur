# Billing — Waffo + guarded ZPay (web top-ups)

Murmur's **web** payment provider is [Waffo](https://waffo.com)'s *Pancake*
checkout, integrated through the `@waffo/pancake-ts` SDK. It funds one-time
**note top-ups** — the credit balance every chargeable action debits (see
[payment-topup-feature.md](payment-topup-feature.md) for the credits model).

This doc is also Murmur's local Waffo interface backup. It mirrors the parts of
the Waffo docs that our code depends on, so future billing work can be reviewed
against local repository truth before opening the external docs.

## Waffo API facts we rely on

- REST base URL: `https://api.waffo.ai/v1`.
- GraphQL endpoint: `https://api.waffo.ai/v1/graphql`; GraphQL is read-only
  for our use and must not replace checkout/webhook mutations.
- Checkout creation is a REST action exposed by the SDK as
  `client.checkout.createSession`.
- `createSession` accepts `productId`, `currency`, optional `priceSnapshot`,
  `buyerEmail`, `successUrl`, `metadata`, `expiresInSeconds`, `darkMode`, and
  `orderMerchantExternalId`.
- `metadata` must be a flat `Record<string, string>`; Murmur stores
  `userId`, `skuId`, `notesGranted`, `purchaseKind`, and custom amount fields
  there.
- `orderMerchantExternalId` is our own order correlation key. Waffo limits it
  to 128 characters; it appears on order/payment/refund payloads when the API
  key checkout path is used.
- Webhook signatures arrive in `X-Waffo-Signature` and must be verified over
  the **raw request body** with `verifyWebhook(rawBody, signature)`.
- Webhook event ids are delivery ids. Use `event.id` for delivery
  de-duplication, and use `data.orderId` as the business order id.
- Relevant event types today are `order.completed` and `refund.succeeded`.
  Subscription events are ignored because Murmur sells one-time top-ups only.

> **Stripe has been removed from web checkout.** Older docs and a `@deprecated
> ResolvedStripeTopupPurchase` alias in
> [topup-purchase.ts](../src/lib/billing/topup-purchase.ts) are the only Stripe
> residue. Mobile-store IAP (Apple / Google via RevenueCat) is future work for
> the Capacitor shells and is **not** wired today. Waffo is the only fully
> refund-webhook-backed web payment path; ZPay is guarded for CNY WeChat checkout
> until its refund / chargeback reversal loop is implemented.

## File map

| Concern | File |
|---|---|
| Server SDK client (lazy, credential-gated) | [src/lib/billing/waffo.ts](../src/lib/billing/waffo.ts) |
| Create checkout session | [src/app/api/billing/checkout/route.ts](../src/app/api/billing/checkout/route.ts) |
| Receive webhook + grant notes | [src/app/api/billing/webhook/route.ts](../src/app/api/billing/webhook/route.ts) |
| Resolve order → purchase (validation) | [src/lib/billing/topup-purchase.ts](../src/lib/billing/topup-purchase.ts) |
| Idempotent ledger grant | [src/lib/db/queries/notes-ledger.ts](../src/lib/db/queries/notes-ledger.ts) |
| SKUs + custom-amount quote | [packages/murmur-core/src/payments/cost-table.ts](../packages/murmur-core/src/payments/cost-table.ts) |
| One-time setup (store + product) | [scripts/waffo-bootstrap.ts](../scripts/waffo-bootstrap.ts) |
| Register webhook endpoint | [scripts/waffo-webhook-register.ts](../scripts/waffo-webhook-register.ts) |
| Read-only Waffo ↔ local reconciliation | [scripts/waffo-reconcile.ts](../scripts/waffo-reconcile.ts) |
| Scheduled Waffo reconciliation | [src/app/api/billing/cron/reconcile/route.ts](../src/app/api/billing/cron/reconcile/route.ts) |
| Guarded CNY ZPay checkout | [src/lib/billing/zpay.ts](../src/lib/billing/zpay.ts) |
| ZPay payment success notify | [src/app/api/billing/zpay-notify/route.ts](../src/app/api/billing/zpay-notify/route.ts) |

## SKUs

The buyable tiers are a **Murmur-side** concept defined in `@murmur/core`
([cost-table.ts](../packages/murmur-core/src/payments/cost-table.ts)). Waffo
only ever sees a single generic one-time product; the real price for a purchase
is set per checkout session via `priceSnapshot.amount`.

| SKU id | Notes granted | Default price | Highlight |
|---|---|---|---|
| `topup_30_notes`  | 30        | $1.99  | — |
| `topup_120_notes` | 120 + 10  | $5.99  | popular |
| `topup_400_notes` | 400 + 50  | $14.99 | best value |
| `topup_custom`    | `amountUsd × 20` | $1–$999 | custom amount |

Bonus notes are added on top of the base (`topupNotesGranted` /
`getCustomTopupQuote`). These display prices are the web defaults; the
cost-table is the single source of truth — never hardcode prices elsewhere.

## Purchase flow

```
TopupScreen
   │  POST /api/billing/checkout  { sku, billingEmail? }  |  { customAmountUsd, billingEmail? }
   ▼
/api/billing/checkout
   │  • auth required (guest → 403 sign_in_required)
   │  • rate-limit 10 / 60s
   │  • resolve SKU / custom quote from @murmur/core
   │  • client.checkout.createSession({ productId, currency,
   │      buyerEmail?, priceSnapshot, metadata, successUrl,
   │      orderMerchantExternalId })
   ▼
   { checkoutUrl }  ──▶  client opens Waffo-hosted checkout (new tab)
                              │  user pays
                              ▼
                         Waffo emits  order.completed
   ┌──────────────────────────┘
   ▼
POST /api/billing/webhook
   │  • verify X-Waffo-Signature over the raw body  (401 on failure)
   │  • record in events_webhook (provider, providerEventId unique)
   │  • order.completed → resolveWaffoTopupPurchase(order)
   │  • insert purchases row (provider, providerRef = orderId)
   │  • grantNotes(reason "purchase:topup", externalRef = orderId)  ← idempotent
   │  • refund.succeeded → amount check, then reverseTopupGrant + refunded status
   ▼
   notes balance += notesGranted
```

The client does **not** grant anything. After the success redirect it polls
`GET /api/user/balance` once; the ledger write only ever happens on the
verified webhook.

### ZPay launch gate

Explicit WeChat checkout (`payMethod: "wxpay"` on a CNY order) uses ZPay only
when `isZpayCheckoutEnabled()` returns true. That requires:

- `ZPAY_PID` and `ZPAY_KEY`;
- outside production, no additional flag, so local/staging integration testing
  remains possible;
- in production, `MURMUR_ALLOW_PRODUCTION_ZPAY_WITHOUT_REFUNDS=1` until Murmur
  has a reliable ZPay refund / chargeback webhook that calls the same
  `reverseTopupGrant` ledger path Waffo uses.

If production credentials are present but that explicit allow flag is absent,
`POST /api/billing/checkout` returns `503 zpay_not_configured` for WeChat
checkout and logs `billing.zpay_checkout_failed` with `stage: "launch_gate"`.
The notify route still accepts verified successful payment callbacks so any
orders created before closing the gate can settle; it does not implement refund
or chargeback reversal.

### Checkout session

`POST /api/billing/checkout` builds the session with:

- `productId` — the single `WAFFO_TOPUP_PRODUCT_ID` (generic top-up product).
- `priceSnapshot.amount` — the SKU's display amount, with
  `TaxCategory.DigitalGoods`.
- `metadata` — `{ userId, skuId, notesGranted, purchaseKind, customAmountUsd? }`.
  This is the trust anchor: the webhook reads the SKU and grant amount back out
  of metadata, never from the client.
- `buyerEmail` — optional editable billing/receipt email from checkout review,
  falling back to the signed-in account email when present.
- `successUrl` — `${origin}/topup/checkout?…&status=success`.
- `orderMerchantExternalId` — `${userId}:${skuId}:${uuid}`.

It returns `{ checkoutUrl, sessionId }`; the client opens `checkoutUrl`.

### Webhook fulfillment

`POST /api/billing/webhook` (Node runtime) handles `order.completed` and
`refund.succeeded`:

1. **Signature** — `verifyWebhook(rawBody, signature)`; missing → 400,
   invalid → 401.
2. **De-dupe** — insert into `events_webhook` with `onConflictDoNothing` on
   `(provider, providerEventId)`. A duplicate that was already processed
   short-circuits to `{ received: true, duplicate: true }`.
3. **Resolve** — `resolveWaffoTopupPurchase` flattens `orderMetadata`, converts
   the display amount to cents, looks up the SKU (or validates the custom
   quote), and asserts the paid amount + `notesGranted` match the quote.
4. **Record** — insert a `purchases` row (`status: "succeeded"`,
   `providerRef = orderId`) with `onConflictDoNothing` on
   `(provider, providerRef)`.
5. **Grant** — `grantNotes({ reason: "purchase:topup", externalRef: orderId })`.
6. **Refund** — for `refund.succeeded`, find the local purchase by Waffo
   `orderId`, convert the Waffo refund `amount` / `currency` to cents, and
   only auto-reverse when that amount exactly equals the local
   `purchases.amountCents`. Full refunds insert a negative `refund:topup`
   ledger row through `reverseTopupGrant`, then flip `purchases.status` to
   `refunded`. Partial or mismatched refund amounts are acknowledged with
   `manualReview: true`, logged as a billing webhook warning, and do not mutate
   the purchase or notes ledger.

`InvalidTopupPurchaseError` (bad/unknown SKU, amount mismatch, missing
`userId`) is treated as **non-retryable** — the route returns `200` so Waffo
stops retrying a payload that will never succeed. Other failures return `500`
so Waffo retries.

Refunds for unknown local orders are also non-retryable. That is intentional:
the provider cannot fix a missing local purchase by retrying the same payload,
and repeated retries would only create noisy failed webhook logs.

## Idempotency

A note top-up is granted **exactly once** even under duplicate webhook delivery,
thanks to three independent guards keyed on the Waffo `orderId`:

1. `events_webhook` unique `(provider, providerEventId)` — each Waffo event is
   processed once.
2. `purchases` unique `(provider, providerRef)` — each order is recorded once.
3. `notes_ledger` idempotency on `(userId, reason, externalRef)` — `grantNotes`
   returns the prior row (`duplicate: true`) instead of granting again.

Refunds use the same pattern. `events_webhook` de-dupes delivery retries,
`purchases.providerRef` finds the original order, and the refund ledger row uses
`externalRef = "waffo-refund:<refundTicketMerchantExternalId>"` when Waffo
supplies the merchant refund-ticket reference. Provider/manual refunds fall back
to `event.eventId`, then the order id. If the user has already spent some of the
refunded top-up, Murmur caps the balance at zero and records the actual notes
recovered in the `refund:topup` ledger row.

Partial Waffo refunds are intentionally not auto-applied yet. The webhook
records enough context for support review, but Murmur currently has no
`partially_refunded` purchase state or durable cumulative refund amount. Until
that exists, refund amounts that differ from the original purchase amount must
be handled manually instead of guessing how many bonus notes to reverse.

See [data-model.md](data-model.md) §3.4 / §3.5 / §3.7 for the table shapes and
the ledger invariant (`SUM(delta) == users.notesBalance`).

## Currency + amount validation

[waffo.ts](../src/lib/billing/waffo.ts) holds `displayAmountToCents` /
`centsToDisplayAmount`, which special-case `JPY` (no fractional unit). Checkout
pins the session currency, so the webhook only enforces cents-equality when the
**paid** currency matches the quote currency; if Waffo settled in a converted
currency, the metadata + `notesGranted` checks carry the validation instead (an
equality check against USD cents would wrongly reject a legitimate payment).

## Configuration

The client is built lazily and is **credential-gated** — routes return `503
waffo_not_configured` when env is absent, so builds and local dev without
secrets keep working (`isWaffoConfigured()`).

| Env var | Purpose |
|---|---|
| `WAFFO_MERCHANT_ID` | merchant identity (required) |
| `WAFFO_PRIVATE_KEY` *or* `WAFFO_PRIVATE_KEY_BASE64` | signing key, inline PEM or base64 (required) |
| `WAFFO_TOPUP_PRODUCT_ID` | the generic one-time top-up product (required) |
| `WAFFO_STORE_ID` | store the webhook is registered against (setup only) |
| `WAFFO_WEBHOOK_URL` | webhook endpoint to register (defaults to `https://murmur.ptoq.io/api/billing/webhook`) |
| `WAFFO_WEBHOOK_TEST_MODE` | force test/live webhook; auto-detected from a localhost URL otherwise |
| `WAFFO_WEBHOOK_PROD_PUBLIC_KEY` / `WAFFO_WEBHOOK_TEST_PUBLIC_KEY` | optional signature verification keys for Waffo key rotation; the SDK also has built-in keys |
| `MURMUR_APP_URL` | origin used to build the checkout `successUrl` |
| `ZPAY_PID` / `ZPAY_KEY` | optional ZPay credentials for CNY WeChat checkout |
| `MURMUR_ALLOW_PRODUCTION_ZPAY_WITHOUT_REFUNDS` | production-only acknowledgement required when ZPay credentials are set before refund / chargeback webhooks exist |

`isWaffoConfigured()` requires both a usable client (merchant id + private key)
**and** `WAFFO_TOPUP_PRODUCT_ID`.

The production env audit fails when only one ZPay credential is set, or when
both are set without `MURMUR_ALLOW_PRODUCTION_ZPAY_WITHOUT_REFUNDS=1`. That is a
launch gate, not a refund implementation.

## Setup scripts

One-time, run with credentials in `.env.local`:

```bash
bun run waffo:bootstrap          # create/find "Murmur" store + generic top-up
                                 # product, publish it, print STORE_ID + PRODUCT_ID
bun run waffo:webhook-register   # register order.completed + refund.succeeded
                                 # → the webhook URL
bun run waffo:reconcile          # read-only GraphQL check against local DB
```

For unattended monitoring, hit `GET /api/billing/cron/reconcile` with
`Authorization: Bearer $CRON_SECRET`. That route reuses the same read-only
reconciliation logic and returns a JSON report with summary + issues. Vercel
cron runs it once daily so Hobby previews stay deployable.

`waffo:bootstrap`
([scripts/waffo-bootstrap.ts](../scripts/waffo-bootstrap.ts)) is idempotent on
the store/product and prints the env lines to paste. `waffo:webhook-register`
([scripts/waffo-webhook-register.ts](../scripts/waffo-webhook-register.ts))
chooses test vs. live mode from `WAFFO_WEBHOOK_TEST_MODE`, falling back to "test
if the URL is localhost."

`waffo:reconcile`
([scripts/waffo-reconcile.ts](../scripts/waffo-reconcile.ts)) uses Waffo
GraphQL in read-only mode. It checks recent succeeded payments against local
`purchases.providerRef = Waffo orderId`, `purchases.amountCents`, and the
matching `notes_ledger.reason = "purchase:topup"` row. It also reports
successful refunds that do not have an observed `refund:topup` ledger row in
the checked window. Refund matching checks both the merchant refund-ticket ref
and the webhook's event/order fallback refs. It exits non-zero only for hard
payment/grant mismatches; refund gaps are warnings until every refund is created
through a Murmur-owned ticket flow.

## Extension points

- **Scheduled GraphQL reconciliation** — `bun run waffo:reconcile` is a manual
  read-only script today. The same logic now backs
  `GET /api/billing/cron/reconcile`; the next step is storing snapshots or
  pushing anomalies into observability.
- **Refund operations UI** — add a small internal billing view that shows
  purchase status, provider refs, refund ledger rows, and webhook delivery ids.
- **Refund ticket correlation** — Waffo exposes both `orderMerchantExternalId`
  and `refundTicketMerchantExternalId`; Murmur should preserve the latter when
  an internal refund tool creates tickets so reconciliation can hard-check
  refunds instead of warning on missing local rows.
- **Partial refund support** — add a durable partial-refund state, cumulative
  refunded amount tracking, and an explicit cents-to-notes rule before
  auto-applying refund amounts smaller than the original purchase.
- **Region-aware tax / billing detail** — pass `billingDetail` when we have a
  reliable billing country. Today the hosted checkout collects provider-side
  details.
- **Payment method telemetry** — store non-sensitive webhook payment fields
  (`paymentMethod`, `paymentLast4` if needed for support) in `rawPayload` only;
  do not copy card data into first-class columns.
- **Subscriptions** — not supported today. Add a separate product and ledger
  contract before handling Waffo `subscription.*` events.

## Deliberately out of scope here

- **Subscriptions** — top-ups are one-time products only.
- **Mobile-store IAP** — Apple / Google via RevenueCat is future Capacitor work;
  [restore-purchases.md](restore-purchases.md) tracks the restore surface that
  IAP will need.
