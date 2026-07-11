/**
 * Canonical Murmur action costs and top-up SKUs.
 *
 * Authoritative reference: docs/payment-topup-feature.md §3 + §4.
 * Server-side spend helpers (apps/web/src/lib/db/queries/notes-ledger.ts)
 * MUST import COST from here. Hard-coding cost values anywhere else is a
 * standards violation per docs/engineering-standards.md §1.
 *
 * Prices in TOPUP_SKUS are display defaults. Real prices for App Store /
 * Play Store SKUs are managed in the respective stores; this table is the
 * fallback + the web shell's source of truth.
 */

/** Action keys that consume notes. Keys are the spend reason without prefix. */
export type CostKey =
  | "hum"
  | "music_generate"
  | "llm_edit"
  | "save"
  | "export_webm";

/** All ledger reason codes — superset of CostKey + grants. */
export type NotesReason =
  // Spends
  | "spend:hum"
  | "spend:music_generate"
  | "spend:llm_edit"
  | "spend:save"
  | "spend:export_webm"
  // Grants
  | "grant:daily_free"
  | "grant:signup_bonus"
  | "grant:cutover_gift"
  | "grant:local_creator"
  | "grant:referral"
  // Purchases
  | "purchase:topup"
  | "refund:topup"
  // Application-level reversal of a failed spend (transcribe/save/etc).
  // Distinct from `refund:topup`, which reverses a `purchase:topup`.
  | "refund:spend"
  // Durable "a spend refund is owed" marker written when an in-request
  // refund write fails. A zero-delta bookkeeping row (balance invariant is
  // preserved); the reconcile cron finds it by external_ref and retries the
  // real `refund:spend` idempotently. Never carries a balance change itself.
  | "refund:pending"
  // Operations
  | "manual:op_grant";

/**
 * Cost of each chargeable action in notes.
 *
 * If a new action is added: update this table, update
 * docs/payment-topup-feature.md §3, and update the matching gate in the UI.
 * Keep legacy keys here when another surface already reads the entitlement;
 * a zero value means the action is deliberately free in the current product.
 */
export const COST: Readonly<Record<CostKey, number>> = Object.freeze({
  hum:          1,
  music_generate: 1,
  llm_edit:     1,
  save:         0,
  export_webm:  0,
});

/**
 * Local Creator one-time preview allowance.
 *
 * This pre-login allowance does not refill and does not unlock account-only
 * billing surfaces. Promotion to a registered account raises the balance to
 * the normal signup baseline without copying songs.
 */
export const LOCAL_CREATOR_FREE_NOTES = 5;

/**
 * Daily signed-in free-tier refill quota.
 *
 * Logic in the server refill helper (docs/payment-topup-feature.md §8):
 *   grant(min(DAILY_REFILL, MAX_FREE_BALANCE - dailyFreeNotesBalance))
 */
export const DAILY_REFILL = 5;
export const MAX_FREE_BALANCE = 10;

/**
 * One-time grant amounts.
 *
 * `cutover_gift` is granted to every existing user on the v2 migration day;
 * docs/payment-topup-feature.md §12 + docs/data-model.md §3.1 backfill.
 */
export const GRANTS = Object.freeze({
  signup_bonus: 15,
  cutover_gift: 50,
  referral: 100,
});

/** Supported payment currencies. */
export type Currency = "USD" | "CNY";

/**
 * Top-up SKU display defaults.
 *
 * The `id` is the SKU identifier used across providers (Stripe Price id,
 * App Store product id, WeChat 商品 id). Keep the ids stable; rename
 * displays freely.
 *
 * Prices listed here are the **web shell defaults**. iOS / Android prices
 * come from RevenueCat (which mirrors the App Store / Play Store price
 * cards); the client merges in vendor-supplied prices on top of these
 * defaults via /api/billing/skus.
 */
export interface TopupSku {
  id: string;
  notes: number;
  /** Extra notes granted on top of `notes` (top-tier incentive). */
  bonusNotes?: number;
  defaultPriceCents: number;
  defaultCurrency: Currency;
  display: string;
  /** CNY price in fen (1/100 yuan). Optional — only present for CNY-enabled SKUs. */
  cnyPriceCents?: number;
  highlight?: "popular" | "best_value";
}

export const CUSTOM_TOPUP_ID = "topup_custom";
export const CUSTOM_TOPUP_MIN_USD = 1;
export const CUSTOM_TOPUP_MAX_USD = 999;
export const CUSTOM_TOPUP_NOTES_PER_USD = 20;

export const CUSTOM_TOPUP_MIN_CNY = 5;
export const CUSTOM_TOPUP_MAX_CNY = 6999;
export const CUSTOM_TOPUP_NOTES_PER_CNY = 3;

export interface CustomTopupQuote {
  id: typeof CUSTOM_TOPUP_ID;
  /** Face-value amount in `defaultCurrency` (USD integer or CNY integer). */
  faceAmount: number;
  amountCents: number;
  notesGranted: number;
  display: string;
  defaultCurrency: Currency;
}

export const TOPUP_SKUS: ReadonlyArray<TopupSku> = Object.freeze([
  {
    id: "topup_30_notes",
    notes: 30,
    defaultPriceCents: 199,
    defaultCurrency: "USD",
    display: "$1.99",
    cnyPriceCents: 1290,
  },
  {
    id: "topup_120_notes",
    notes: 120,
    bonusNotes: 10,
    defaultPriceCents: 599,
    defaultCurrency: "USD",
    display: "$5.99",
    cnyPriceCents: 4290,
    highlight: "popular",
  },
  {
    id: "topup_400_notes",
    notes: 400,
    bonusNotes: 50,
    defaultPriceCents: 1499,
    defaultCurrency: "USD",
    display: "$14.99",
    cnyPriceCents: 10800,
    highlight: "best_value",
  },
]);

/** Look up a SKU by id; null lets route handlers map to a 400 cleanly. */
export function getTopupSku(id: string): TopupSku | null {
  return TOPUP_SKUS.find((sku) => sku.id === id) ?? null;
}

/** Notes actually granted for a SKU purchase (base + bonus). */
export function topupNotesGranted(sku: TopupSku): number {
  return sku.notes + (sku.bonusNotes ?? 0);
}

export function isValidCustomTopupAmount(amountUsd: unknown): amountUsd is number {
  return (
    typeof amountUsd === "number"
    && Number.isInteger(amountUsd)
    && amountUsd >= CUSTOM_TOPUP_MIN_USD
    && amountUsd <= CUSTOM_TOPUP_MAX_USD
  );
}

export function getCustomTopupQuote(amountUsd: number): CustomTopupQuote | null {
  if (!isValidCustomTopupAmount(amountUsd)) return null;
  return {
    id: CUSTOM_TOPUP_ID,
    faceAmount: amountUsd,
    amountCents: amountUsd * 100,
    notesGranted: amountUsd * CUSTOM_TOPUP_NOTES_PER_USD,
    display: `$${amountUsd}`,
    defaultCurrency: "USD",
  };
}

export function isValidCustomTopupAmountCny(amountCny: unknown): amountCny is number {
  return (
    typeof amountCny === "number"
    && Number.isInteger(amountCny)
    && amountCny >= CUSTOM_TOPUP_MIN_CNY
    && amountCny <= CUSTOM_TOPUP_MAX_CNY
  );
}

export function getCustomTopupQuoteCny(amountCny: number): CustomTopupQuote | null {
  if (!isValidCustomTopupAmountCny(amountCny)) return null;
  return {
    id: CUSTOM_TOPUP_ID,
    faceAmount: amountCny,
    amountCents: amountCny * 100,
    notesGranted: amountCny * CUSTOM_TOPUP_NOTES_PER_CNY,
    display: `¥${amountCny.toFixed(2)}`,
    defaultCurrency: "CNY",
  };
}

/** Regional price for a SKU in the given currency. */
export function getRegionalPrice(
  sku: TopupSku,
  currency: Currency,
): { priceCents: number; currency: Currency; display: string } {
  if (currency === "CNY" && sku.cnyPriceCents != null) {
    const yuan = sku.cnyPriceCents / 100;
    return {
      priceCents: sku.cnyPriceCents,
      currency: "CNY",
      display: `¥${yuan.toFixed(2)}`,
    };
  }
  return {
    priceCents: sku.defaultPriceCents,
    currency: "USD",
    display: sku.display,
  };
}

/**
 * Convenience guard for callers that have a string and want a CostKey.
 *
 * Returns null instead of throwing so route handlers can map to a 400
 * envelope cleanly.
 */
export function asCostKey(value: string): CostKey | null {
  return value === "hum"
      || value === "music_generate"
      || value === "llm_edit"
      || value === "save"
      || value === "export_webm"
    ? (value as CostKey)
    : null;
}
