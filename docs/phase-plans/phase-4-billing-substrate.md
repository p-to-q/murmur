# Phase 4 Substrate — Notes Ledger + Transcribe Gate

Date: 2026-06-03

> **Update (2026-06):** the billing carry-forward below later shipped on
> **Waffo** (not Stripe) for the web shell — checkout
> (`/api/billing/checkout`) and the `order.completed` webhook
> (`/api/billing/webhook`) are live. Stripe was never wired and is out of the
> plan. Current web billing is documented in
> [../billing-waffo.md](../billing-waffo.md). The daily refill cron and
> native-IAP channels remain pending.

## User / System Problem

The audio worker is now a real server-side compute surface. If transcription
remains free and unmetered in the API, the later top-up/payment system will have
to retrofit cost semantics into routes that already shipped. This slice does
not ship checkout; it establishes the ledger and route contract that checkout
will fund.

## Real Constraints

- Auth is still the local header/guest stub from Phase 3 carry-forward. Do not
  pretend this is production identity.
- The Web app is still the root Next app under `src/`; no app-shell move here.
- Local demo behavior still matters, but real `/api/transcribe` is now an
  expensive worker path and should be measurable.
- Web checkout, WeChat Pay, RevenueCat, top-up UI, and daily refill jobs remain
  future stops.

## Stable Behavior

- Explicit demo melody remains free because it does not call `/api/transcribe`.
- Worker failures and no-voice failures do not spend notes; spend occurs only
  after a successful scored melody response.
- `guest` can still be auto-provisioned for local/demo use, but arbitrary
  spoofed user IDs are not auto-created by the billing helper.

## Shipped

- Registered `notes_ledger` and `purchases` in the Drizzle schema index.
- Added `users.notes_balance`, `users.free_notes_granted_at`, and
  `users.plan_tier`.
- Added migration `0002_warm_rumiko_fujikawa` which creates ledger/purchase
  tables, grants existing users the 50-note cutover gift, and records matching
  `grant:cutover_gift` ledger rows.
- Added `src/lib/db/queries/notes-ledger.ts` with:
  - `getNotesBalance`
  - `spendNotes`
  - `grantNotes`
  - initial-ledger reconciliation so materialized balances do not drift from
    the ledger invariant.
- Added `GET /api/user/balance`, returning `{ notes, planTier, nextRefillAt }`.
- Gated `POST /api/transcribe` with `COST.hum`:
  - returns `402 insufficient_notes` before worker execution when balance is
    too low;
  - spends `1` note only after successful transcription;
  - logs `notes.spent` with the ledger id and post-spend balance.
- Gated `POST /api/strummer/edit` with `COST.llm_edit`:
  - refuses before the LLM call when balance is too low;
  - spends only after a successful LLM classification.
- `POST /api/songs` now follows `COST.save === 0`:
  - signed-in saves are free and do not write spend rows;
  - guest cloud saves remain identity-gated before payment.

## Carry-Forward

- Real provider login and DB-backed session validation still need Phase 3,
  though v1 header identity is now local/demo-only in production settings.
- Web checkout + the billing webhook shipped on Waffo (see
  [../billing-waffo.md](../billing-waffo.md)). `/topup` page polish, the
  region-aware SKU route, native-IAP channels, and the daily refill cron are
  still pending.
- MeScreen and Studio balance-aware UI are still pending.
- Full DB-backed API route tests need the test database harness described in
  `docs/testing-strategy.md`.
