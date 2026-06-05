/**
 * Entitlement resolver.
 *
 * Defines who can do what, in one place, derived from user + balance.
 * Entitlements are NEVER stored as flags — they are always computed from
 * the user row + the current notes balance. See docs/user-model.md §5.
 *
 * Pages call useEntitlement() (a thin client hook); server routes call
 * resolveEntitlement(user, balance) directly during request handling.
 */

import { COST } from "../payments/cost-table";

/**
 * Runtime user type, derived from the persisted user row.
 *
 * - `guest`    — no session bound to an identity (Web only; iOS / MP do
 *                not have a guest tier).
 * - `free`     — authenticated; default plan tier.
 * - `premium`  — RESERVED for v3; the resolver tolerates the value but
 *                no surface depends on it yet.
 *
 * See docs/user-model.md §2.
 */
export type UserType = "guest" | "free" | "premium";

/**
 * Minimal shape this resolver needs. Intentionally NOT the DB User type
 * — the package must not import Drizzle. apps/web converts its User to
 * this shape at the call site.
 */
export interface EntitlementUser {
  id: string;
  planTier: "free" | "premium";
  /** True when this user is bound to at least one external identity. */
  isAuthenticated: boolean;
}

/**
 * What the user can do right now.
 *
 * Always render UI from this object. Do not call gated APIs and rely on
 * a 402 to detect the gate; the 402 is the safety net, not the UX.
 */
export interface Entitlement {
  canHum:           boolean;
  canSave:          boolean;
  canLlmEdit:       boolean;
  canExportWebm:    boolean;
  canTopUp:         boolean;
  canDeleteAccount: boolean;
  remainingNotes:   number;
}

/**
 * Pure derivation. No DB, no network, no side effects.
 */
export function userType(user: EntitlementUser | null): UserType {
  if (!user) return "guest";
  if (!user.isAuthenticated) return "guest";
  if (user.planTier === "premium") return "premium";
  return "free";
}

/**
 * Compute the full entitlement for a request.
 *
 * `balance` must be the latest notes balance — pass the value from
 * users.notesBalance, never a cached stale copy. Server routes acquire
 * SELECT ... FOR UPDATE before calling spend helpers; this resolver
 * is for read paths and UI hydration only.
 */
export function resolveEntitlement(
  user: EntitlementUser | null,
  balance: number,
): Entitlement {
  const type = userType(user);
  const isAuthed = type !== "guest";

  return {
    canHum:           balance >= COST.hum,
    canSave:          isAuthed && balance >= COST.save,
    canLlmEdit:       balance >= COST.llm_edit,
    canExportWebm:    isAuthed && balance >= COST.export_webm,
    canTopUp:         isAuthed,
    canDeleteAccount: isAuthed,
    remainingNotes:   balance,
  };
}
