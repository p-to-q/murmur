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
 * FREE ERA (2026-06): every cost is 0 — notes are unlimited by product
 * decision. A zero cost short-circuits in `spendNotes` (no ledger row, no
 * balance change), so the 402 wall is unreachable while the ledger, grants,
 * and Stripe top-up machinery stay dormant but intact. To re-enable
 * monetization, restore real prices here and the rest wakes up unchanged.
 */
export const COST: Readonly<Record<CostKey, number>> = Object.freeze({
  hum:          0,
  llm_edit:     0,
  save:         0,
  export_webm:  0,
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
  signup_bonus: 10,
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
