/**
 * @murmur/core — public surface.
 *
 * Curated. New exports must be added here intentionally; do not blanket
 * re-export from submodules. See packages/murmur-core/README.md.
 */

// Payments
export {
  COST,
  DAILY_REFILL,
  GRANTS,
  LOCAL_CREATOR_FREE_NOTES,
  MAX_FREE_BALANCE,
  TOPUP_SKUS,
  CUSTOM_TOPUP_ID,
  CUSTOM_TOPUP_MIN_USD,
  CUSTOM_TOPUP_MAX_USD,
  CUSTOM_TOPUP_NOTES_PER_USD,
  CUSTOM_TOPUP_MIN_CNY,
  CUSTOM_TOPUP_MAX_CNY,
  CUSTOM_TOPUP_NOTES_PER_CNY,
  getTopupSku,
  getCustomTopupQuote,
  getCustomTopupQuoteCny,
  getRegionalPrice,
  isValidCustomTopupAmount,
  isValidCustomTopupAmountCny,
  topupNotesGranted,
  type TopupSku,
  type CustomTopupQuote,
  type Currency,
  type NotesReason,
  type CostKey,
} from "./payments/cost-table";

// Auth
export {
  resolveEntitlement,
  userType,
  type Entitlement,
  type UserType,
} from "./auth/entitlements";

// Music
export {
  INSTRUMENT_RANGES,
  clampPitchToInstrument,
  type InstrumentRange,
  type InstrumentId,
} from "./music/instrument-ranges";

// Shared types — placeholder; the carve-out will populate this fully
// during Phase 5 of docs/execution-roadmap.md.
export type * from "./shared-types";
