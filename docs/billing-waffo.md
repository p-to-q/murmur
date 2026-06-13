# Billing — Waffo (web top-ups)

Murmur's **web** payment provider is [Waffo](https://waffo.com)'s *Pancake*
checkout, integrated through the `@waffo/pancake-ts` SDK. It funds one-time
**note top-ups** — the credit balance every chargeable action debits (see
[payment-topup-feature.md](payment-topup-feature.md) for the credits model).

> **Stripe has been removed from web checkout.** Older docs and a `@deprecated
> ResolvedStripeTopupPurchase` alias in
> [topup-purchase.ts](../src/lib/billing/topup-purchase.ts) are the only Stripe
> residue. Mobile-store IAP (Apple / Google via RevenueCat) is future work for
> the Capacitor shells and is **not** wired today; Waffo is the only live
> payment path.

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
   │  POST /api/billing/checkout  { sku }  |  { customAmountUsd }
   ▼
/api/billing/checkout
   │  • auth required (guest → 403 sign_in_required)
   │  • rate-limit 10 / 60s
   │  • resolve SKU / custom quote from @murmur/core
   │  • client.checkout.createSession({ productId, currency,
   │      priceSnapshot, metadata, successUrl, orderMerchantExternalId })
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
   ▼
   notes balance += notesGranted
```

The client does **not** grant anything. After the success redirect it polls
`GET /api/user/balance` once; the ledger write only ever happens on the
verified webhook.

### Checkout session

`POST /api/billing/checkout` builds the session with:

- `productId` — the single `WAFFO_TOPUP_PRODUCT_ID` (generic top-up product).
- `priceSnapshot.amount` — the SKU's display amount, with
  `TaxCategory.DigitalGoods`.
- `metadata` — `{ userId, skuId, notesGranted, purchaseKind, customAmountUsd? }`.
  This is the trust anchor: the webhook reads the SKU and grant amount back out
  of metadata, never from the client.
- `successUrl` — `${origin}/topup/checkout?…&status=success`.
- `orderMerchantExternalId` — `${userId}:${skuId}:${uuid}`.

It returns `{ checkoutUrl, sessionId }`; the client opens `checkoutUrl`.

### Webhook fulfillment

`POST /api/billing/webhook` (Node runtime) handles `order.completed`:

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

`InvalidTopupPurchaseError` (bad/unknown SKU, amount mismatch, missing
`userId`) is treated as **non-retryable** — the route returns `200` so Waffo
stops retrying a payload that will never succeed. Other failures return `500`
so Waffo retries.

## Idempotency

A note top-up is granted **exactly once** even under duplicate webhook delivery,
thanks to three independent guards keyed on the Waffo `orderId`:

1. `events_webhook` unique `(provider, providerEventId)` — each Waffo event is
   processed once.
2. `purchases` unique `(provider, providerRef)` — each order is recorded once.
3. `notes_ledger` idempotency on `(userId, reason, externalRef)` — `grantNotes`
   returns the prior row (`duplicate: true`) instead of granting again.

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
| `MURMUR_APP_URL` | origin used to build the checkout `successUrl` |

`isWaffoConfigured()` requires both a usable client (merchant id + private key)
**and** `WAFFO_TOPUP_PRODUCT_ID`.

## Setup scripts

One-time, run with credentials in `.env.local`:

```bash
bun run waffo:bootstrap          # create/find "Murmur" store + generic top-up
                                 # product, publish it, print STORE_ID + PRODUCT_ID
bun run waffo:webhook-register   # register order.completed → the webhook URL
```

`waffo:bootstrap`
([scripts/waffo-bootstrap.ts](../scripts/waffo-bootstrap.ts)) is idempotent on
the store/product and prints the env lines to paste. `waffo:webhook-register`
([scripts/waffo-webhook-register.ts](../scripts/waffo-webhook-register.ts))
chooses test vs. live mode from `WAFFO_WEBHOOK_TEST_MODE`, falling back to "test
if the URL is localhost."

## Deliberately out of scope here

- **Refunds** — the ledger supports `refund:topup`, but there is no Waffo refund
  webhook handler or op-tool wired yet.
- **Subscriptions** — top-ups are one-time products only.
- **Mobile-store IAP** — Apple / Google via RevenueCat is future Capacitor work;
  [restore-purchases.md](restore-purchases.md) tracks the restore surface that
  IAP will need.
