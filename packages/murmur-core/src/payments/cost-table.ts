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
  | "llm_edit"
  | "save"
  | "export_webm";

/** All ledger reason codes — superset of CostKey + grants. */
export type NotesReason =
  // Spends
  | "spend:hum"
  | "spend:llm_edit"
  | "spend:save"
  | "spend:export_webm"
  // Grants
  | "grant:daily_free"
  | "grant:signup_bonus"
  | "grant:cutover_gift"
  // Purchases
  | "purchase:topup"
  | "refund:topup"
  // Application-level reversal of a failed spend (transcribe/save/etc).
  // Distinct from `refund:topup`, which reverses a `purchase:topup`.
  | "refund:spend"
  // Operations
  | "manual:op_grant";

/**
 * Cost of each chargeable action in notes.
 *
 * If a new action is added: update this table, update
 * docs/payment-topup-feature.md §3, and update the matching gate in the UI.
 * Do not introduce a "free for now" cost; either it costs something or it
 * does not need to be in this table.
 */
export const COST: Readonly<Record<CostKey, number>> = Object.freeze({
  hum:          1,
  llm_edit:     1,
  save:         0,
  export_webm:  2,
});

/**
 * Daily free-tier refill quota.
 *
 * Logic in the cron job (docs/payment-topup-feature.md §8):
 *   grant(min(DAILY_REFILL, MAX_FREE_BALANCE - currentBalance))
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
});

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
  defaultCurrency: "USD" | "CNY";
  display: string;
  highlight?: "popular" | "best_value";
}

export const CUSTOM_TOPUP_ID = "topup_custom";
export const CUSTOM_TOPUP_MIN_USD = 1;
export const CUSTOM_TOPUP_MAX_USD = 999;
export const CUSTOM_TOPUP_NOTES_PER_USD = 20;

export interface CustomTopupQuote {
  id: typeof CUSTOM_TOPUP_ID;
  amountUsd: number;
  amountCents: number;
  notesGranted: number;
  display: string;
  defaultCurrency: "USD";
}

export const TOPUP_SKUS: ReadonlyArray<TopupSku> = Object.freeze([
  {
    id: "topup_30_notes",
    notes: 30,
    defaultPriceCents: 199,
    defaultCurrency: "USD",
    display: "$1.99",
  },
  {
    id: "topup_120_notes",
    notes: 120,
    bonusNotes: 10,
    defaultPriceCents: 599,
    defaultCurrency: "USD",
    display: "$5.99",
    highlight: "popular",
  },
  {
    id: "topup_400_notes",
    notes: 400,
    bonusNotes: 50,
    defaultPriceCents: 1499,
    defaultCurrency: "USD",
    display: "$14.99",
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
    amountUsd,
    amountCents: amountUsd * 100,
    notesGranted: amountUsd * CUSTOM_TOPUP_NOTES_PER_USD,
    display: `$${amountUsd}`,
    defaultCurrency: "USD",
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
      || value === "llm_edit"
      || value === "save"
      || value === "export_webm"
    ? (value as CostKey)
    : null;
}
