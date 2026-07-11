/**
 * Pure decision logic for the notes ledger.
 *
 * The DB orchestration in `src/lib/db/queries/notes-ledger.ts`
 * delegates every branch to these functions so the rules can be
 * tested without standing up Postgres or mocking the drizzle query
 * builder. SELECT ... FOR UPDATE on the user row + the partial
 * unique index on (user_id, reason, external_ref) live in the
 * orchestrator; everything else is here.
 *
 * Invariants enforced here (not in SQL):
 *   - A spend whose externalRef already produced a row is a no-op
 *     (`duplicate`), never an error. This makes webhook retries safe
 *     even if the unique index isn't yet enforced (older DBs, dev).
 *   - A refund is only valid against a negative-delta row (a spend).
 *     Refunding a grant or another refund is rejected explicitly.
 *   - A refund's amount is `Math.abs(original.delta)` — the rule is
 *     "undo the spend", not "honour an arbitrary positive number".
 */

export interface ExistingLedgerRow {
  id: string;
  delta: number;
}

export type SpendDecision =
  | { kind: "duplicate"; ledgerId: string; balanceBefore: number; balanceAfter: number }
  | { kind: "proceed"; balanceAfter: number }
  | { kind: "insufficient"; currentBalance: number };

export function decideSpend(input: {
  currentBalance: number;
  cost: number;
  existing: ExistingLedgerRow | null;
}): SpendDecision {
  if (input.existing) {
    return {
      kind: "duplicate",
      ledgerId: input.existing.id,
      balanceBefore: input.currentBalance,
      balanceAfter: input.currentBalance,
    };
  }
  if (input.currentBalance < input.cost) {
    return { kind: "insufficient", currentBalance: input.currentBalance };
  }
  return { kind: "proceed", balanceAfter: input.currentBalance - input.cost };
}

export type GrantDecision =
  | { kind: "duplicate"; ledgerId: string; balanceBefore: number; balanceAfter: number }
  | { kind: "proceed"; balanceAfter: number };

export function decideGrant(input: {
  currentBalance: number;
  amount: number;
  existing: ExistingLedgerRow | null;
}): GrantDecision {
  if (input.existing) {
    return {
      kind: "duplicate",
      ledgerId: input.existing.id,
      balanceBefore: input.currentBalance,
      balanceAfter: input.currentBalance,
    };
  }
  return { kind: "proceed", balanceAfter: input.currentBalance + input.amount };
}

export type RefundDecision =
  | { kind: "duplicate"; ledgerId: string; balanceAfter: number; amount: number }
  // The operation was already delivered (#298): a reversal here would refund
  // delivered work, so skip without writing a refund row. Balance is unchanged.
  | { kind: "delivered"; amount: number }
  | { kind: "proceed"; balanceAfter: number; amount: number }
  | { kind: "original_missing" }
  | { kind: "original_not_spend" };

export function decideRefund(input: {
  currentBalance: number;
  original: { id: string; delta: number } | null;
  existingRefund: ExistingLedgerRow | null;
  /**
   * True when an `operation:delivered` marker exists for this spend (#298).
   * A delivered operation must not be refunded by a later reconcile pass — the
   * user received the work. Checked *after* `existingRefund` so an already
   * materialized refund (whose balance was restored by a re-charge) still
   * dedupes rather than being re-reported as delivered.
   */
  delivered?: boolean;
}): RefundDecision {
  if (!input.original) return { kind: "original_missing" };
  if (input.original.delta >= 0) return { kind: "original_not_spend" };

  const amount = Math.abs(input.original.delta);
  if (input.existingRefund) {
    return {
      kind: "duplicate",
      ledgerId: input.existingRefund.id,
      balanceAfter: input.currentBalance,
      amount,
    };
  }
  if (input.delivered) {
    return { kind: "delivered", amount };
  }
  return {
    kind: "proceed",
    balanceAfter: input.currentBalance + amount,
    amount,
  };
}

export type TopupReversalDecision =
  | { kind: "duplicate"; ledgerId: string; balanceAfter: number; amount: number }
  | {
      kind: "proceed";
      /** Notes actually clawed back — `Math.min(amount, availableBalance)`. */
      amount: number;
      /** Post-reversal balance, floored at 0 so a reversal never locks the user out. */
      balanceAfter: number;
      /** True when the requested reversal exceeded the spendable balance. */
      clamped: boolean;
      /** Requested minus applied — the shortfall the provider refunded but we could not claw back. */
      unrefunded: number;
    };

/**
 * Reverse a confirmed top-up grant, clamping the claw-back so the ledger
 * balance can never be driven negative.
 *
 * Policy (#233): a full provider refund after the buyer already spent some of
 * the purchased notes must not push `notes_balance` below zero — a negative
 * balance blocks every future spend and effectively locks the account out. We
 * claw back only what is still on the balance (`min(amount, currentBalance)`)
 * and record the shortfall as `unrefunded` so reconciliation / support can see
 * that the money was refunded but the notes were already consumed. This is the
 * safer default; the alternative (reject + manual review) is a product-policy
 * call flagged for the owner in the PR.
 */
export function decideTopupReversal(input: {
  currentBalance: number;
  amount: number;
  existingRefund: ExistingLedgerRow | null;
}): TopupReversalDecision {
  if (input.existingRefund) {
    return {
      kind: "duplicate",
      ledgerId: input.existingRefund.id,
      balanceAfter: input.currentBalance,
      amount: Math.abs(input.existingRefund.delta),
    };
  }
  // Only notes currently on the balance can be clawed back; a balance already
  // in debt (negative) has nothing to reverse.
  const available = Math.max(0, input.currentBalance);
  const applied = Math.min(input.amount, available);
  const unrefunded = input.amount - applied;
  return {
    kind: "proceed",
    amount: applied,
    balanceAfter: input.currentBalance - applied,
    clamped: unrefunded > 0,
    unrefunded,
  };
}

/**
 * Deterministic external_ref string a refund writes so the
 * unique-partial idempotency index dedupes duplicate refund attempts
 * targeting the same original spend.
 */
export function refundReferenceFor(originalLedgerId: string): string {
  return `refund:${originalLedgerId}`;
}

/** external_ref prefix for the durable "a spend refund is owed" marker (#232). */
const PENDING_REFUND_REF_PREFIX = "refund_pending:";

/**
 * Deterministic external_ref for a `refund:pending` marker, keyed by the
 * original spend's ledger id. Stable so a retried failure `onConflictDoNothing`
 * against the idempotency index instead of writing a duplicate marker.
 */
export function pendingRefundReferenceFor(originalLedgerId: string): string {
  return `${PENDING_REFUND_REF_PREFIX}${originalLedgerId}`;
}

/**
 * Recover the original spend's ledger id from a `refund:pending` marker's
 * external_ref. Returns null when the ref isn't a pending marker (defensive —
 * the reconcile loop skips anything it can't route back to a spend).
 */
export function originalLedgerIdFromPendingRef(externalRef: string | null): string | null {
  if (!externalRef || !externalRef.startsWith(PENDING_REFUND_REF_PREFIX)) return null;
  const id = externalRef.slice(PENDING_REFUND_REF_PREFIX.length);
  return id.length > 0 ? id : null;
}

// ─── Operation state machine (#298) ────────────────────────────────
//
// A "recording operation" (one transcribe/generate the user is retrying with a
// stable operation id) is modelled as the set of ledger rows that share a spend
// identity. All of the following are keyed to the spend's ledger id, so the
// operation's state is *derived* from which rows exist — nothing mutates:
//
//   spend       spend:<kind>          delta -cost   ref = operation ref
//   refund      refund:spend          delta +cost   ref = refund:<spendId>
//   pending     refund:pending        delta  0      ref = refund_pending:<spendId>
//   delivered   operation:delivered   delta  0      ref = op_delivered:<spendId>
//   recharge    spend:<kind>          delta -cost   ref = recharge:<spendId>
//
// The net charge of an operation is the sum of those deltas. The contract is
// "exactly one net charge for a delivered operation, zero for a reversed one":
//   • charged  = spend only                              → net -cost
//   • refunded = spend + refund                          → net 0
//   • pending  = spend + pending (refund write failed)   → net -cost (owed back)
//   • delivered= spend + delivered (+ recharge if it had → net -cost
//                been refunded first)
//
// Delivery settlement (`decideOperationDelivery`) is what restores the single
// net charge after a failure already refunded (or owed a refund on) the spend.

/** external_ref for the re-charge that restores one net charge after delivery (#298). */
const RECHARGE_REF_PREFIX = "recharge:";

/** external_ref for the durable "operation delivered" marker (#298). */
const OPERATION_DELIVERED_REF_PREFIX = "op_delivered:";

export function rechargeReferenceFor(spendLedgerId: string): string {
  return `${RECHARGE_REF_PREFIX}${spendLedgerId}`;
}

export function deliveredReferenceFor(spendLedgerId: string): string {
  return `${OPERATION_DELIVERED_REF_PREFIX}${spendLedgerId}`;
}

/** The five operation states named by #298. */
export type OperationState =
  | "charged"
  | "refunded"
  | "refund_pending"
  | "delivered"
  | "retryable";

/**
 * Derive the operation state from the existence of its keyed ledger rows.
 *
 * `delivered` is terminal and wins over everything (the work reached the user).
 * `retryable` is the union of "refunded" and "refund_pending" — a failed
 * attempt whose charge was reversed (or is owed back) and which a retry may
 * still turn into delivered work. Callers that need the finer distinction read
 * `hasRefund` / `hasPending` directly; `deriveOperationState` collapses them to
 * the retry-relevant label.
 */
export function deriveOperationState(input: {
  hasSpend: boolean;
  hasRefund: boolean;
  hasPending: boolean;
  hasDelivered: boolean;
}): OperationState {
  if (input.hasDelivered) return "delivered";
  if (input.hasRefund) return "refunded";
  if (input.hasPending) return "refund_pending";
  return "charged";
}

export type OperationDeliveryDecision =
  // The delivered marker already exists — settlement is a no-op replay.
  | { kind: "already_delivered" }
  // Record delivery; the charge is already correct (happy path, or a
  // pending-only operation whose balance was never actually reversed).
  | {
      kind: "delivered";
      writeDelivered: true;
      writeRecharge: false;
      balanceAfter: number;
      dailyFreeAfter: number;
    }
  // Record delivery AND re-charge, because a completed refund had reversed the
  // spend — the re-charge restores the single net charge for delivered work.
  | {
      kind: "delivered_recharged";
      writeDelivered: true;
      writeRecharge: true;
      rechargeAmount: number;
      balanceAfter: number;
      dailyFreeAfter: number;
      rechargePools: RechargePools;
    };

export interface RechargePools {
  dailyFreeReSpent: number;
  accountReSpent: number;
  dailyFreeAfter: number;
  accountAfter: number;
}

/**
 * Decide what delivery settlement must write so the operation ends in exactly
 * one net charge and no reconcile pass will refund it (#298).
 *
 *   • already delivered → replay no-op.
 *   • a completed refund exists → the spend was reversed (failure → refund →
 *     retry succeeded): re-charge to bring the net back to one charge, and the
 *     existing refund makes any pending marker a reconcile no-op.
 *   • only a pending marker (or nothing) → the balance was never actually
 *     reversed (net is still one charge); just record delivery so refundNotes /
 *     the reconciler skip the owed refund for delivered work.
 *
 * The re-charge re-spends from the *same* pools the original spend used, so a
 * refund → re-charge round trip is daily-free-pool neutral.
 */
export function decideOperationDelivery(input: {
  spend: { delta: number; metadata: Record<string, unknown> };
  hasRefund: boolean;
  hasDelivered: boolean;
  hasRecharge: boolean;
  currentBalance: number;
  currentDailyFree: number;
}): OperationDeliveryDecision {
  if (input.hasDelivered) return { kind: "already_delivered" };

  const needsRecharge = input.hasRefund && !input.hasRecharge;
  if (!needsRecharge) {
    return {
      kind: "delivered",
      writeDelivered: true,
      writeRecharge: false,
      balanceAfter: input.currentBalance,
      dailyFreeAfter: trimDailyFreeAfterTopupReversal(
        input.currentDailyFree,
        input.currentBalance,
      ),
    };
  }

  const cost = Math.abs(input.spend.delta);
  const balanceAfter = input.currentBalance - cost;
  const rechargePools = decideRechargePoolsForOriginalSpend(
    input.spend.metadata,
    input.currentDailyFree,
    balanceAfter,
  );
  return {
    kind: "delivered_recharged",
    writeDelivered: true,
    writeRecharge: true,
    rechargeAmount: cost,
    balanceAfter,
    dailyFreeAfter: rechargePools.dailyFreeAfter,
    rechargePools,
  };
}

/**
 * Re-spend the daily-free portion the original spend consumed, so a
 * refund (which restored it) followed by this re-charge nets to zero on the
 * daily-free pool. Mirrors `decideRefundPoolsForOriginalSpend` in reverse.
 */
export function decideRechargePoolsForOriginalSpend(
  metadata: Record<string, unknown>,
  currentDailyFree: number,
  balanceAfter: number,
): RechargePools {
  const spendPools = objectField(metadata, "spendPools");
  const dailyFreeSpent = numberField(spendPools, "dailyFreeSpent");
  const accountSpent = numberField(spendPools, "accountSpent");
  const dailyFreeReSpent = Math.min(
    clampNonNegative(dailyFreeSpent ?? 0),
    clampNonNegative(currentDailyFree),
  );
  const dailyFreeAfter = Math.min(
    clampNonNegative(currentDailyFree) - dailyFreeReSpent,
    clampNonNegative(balanceAfter),
  );
  return {
    dailyFreeReSpent,
    accountReSpent: clampNonNegative(accountSpent ?? 0),
    dailyFreeAfter,
    accountAfter: accountNotesFromTotal(balanceAfter, dailyFreeAfter),
  };
}

/** Split a spend across daily-free notes first, then the account pool. */
export function decideSpendPoolsForCost(
  user: { notesBalance: number; dailyFreeNotesBalance: number },
  cost: number,
) {
  const dailyFreeBefore = Math.min(
    clampNonNegative(user.dailyFreeNotesBalance),
    clampNonNegative(user.notesBalance),
  );
  const dailyFreeSpent = Math.min(dailyFreeBefore, cost);
  const accountSpent = cost - dailyFreeSpent;
  return {
    dailyFreeBefore,
    accountBefore: accountNotesFromTotal(user.notesBalance, dailyFreeBefore),
    dailyFreeSpent,
    accountSpent,
    dailyFreeAfter: dailyFreeBefore - dailyFreeSpent,
    accountAfter: accountNotesFromTotal(
      user.notesBalance - cost,
      dailyFreeBefore - dailyFreeSpent,
    ),
  };
}

/** Derive the account pool from total notes and the daily-free sub-balance. */
export function accountNotesFromTotal(total: number, dailyFree: number): number {
  return Math.max(
    0,
    clampNonNegative(total) - Math.min(clampNonNegative(total), clampNonNegative(dailyFree)),
  );
}

/** Keep the daily-free pool valid after total balance shrinks. */
export function trimDailyFreeAfterTopupReversal(
  dailyFreeNotes: number,
  balanceAfter: number,
): number {
  return Math.min(clampNonNegative(dailyFreeNotes), clampNonNegative(balanceAfter));
}

/** Apply a daily-free grant while respecting negative debt first. */
export function dailyFreeAfterGrant(input: {
  currentBalance: number;
  currentDailyFree: number;
  grantAmount: number;
  maxDailyFreeBalance: number;
}): number {
  const balanceAfter = input.currentBalance + input.grantAmount;
  return Math.min(
    clampNonNegative(input.currentDailyFree) + clampNonNegative(input.grantAmount),
    clampNonNegative(balanceAfter),
    clampNonNegative(input.maxDailyFreeBalance),
  );
}

/** Restore the daily-free portion of a refunded spend when metadata allows it. */
export function decideRefundPoolsForOriginalSpend(
  metadata: Record<string, unknown>,
  currentDailyFree: number,
  balanceAfter: number,
  maxDailyFreeBalance: number,
) {
  const spendPools = objectField(metadata, "spendPools");
  const dailyFreeSpent = numberField(spendPools, "dailyFreeSpent");
  const accountSpent = numberField(spendPools, "accountSpent");
  const dailyFreeRestore = Math.min(
    clampNonNegative(dailyFreeSpent ?? 0),
    clampNonNegative(balanceAfter),
  );
  const dailyFreeAfter = Math.min(
    clampNonNegative(currentDailyFree) + dailyFreeRestore,
    clampNonNegative(balanceAfter),
    clampNonNegative(maxDailyFreeBalance),
  );

  return {
    dailyFreeRestore,
    accountRestore: clampNonNegative(accountSpent ?? 0),
    dailyFreeAfter,
    accountAfter: accountNotesFromTotal(balanceAfter, dailyFreeAfter),
  };
}

export interface BillingAccountSnapshot {
  notesBalance: number;
  accountKind: string;
  freeNotesGrantedAt: Date;
  hasLedgerRows: boolean;
}

export interface BillingAccountMaintenance {
  needsInitialLedger: boolean;
  needsDailyFreeRefill: boolean;
}

/**
 * Decide which billing-account maintenance transactions actually have work
 * to do, from a single non-locking snapshot of the user row.
 *
 * `ensureBillingAccount` runs before every balance read and spend, but its
 * two maintenance steps are no-ops on virtually every request (the initial
 * ledger exists after the first call ever; the daily refill lands at most
 * once per refill window). Deciding from a plain read lets the orchestrator
 * skip both SELECT ... FOR UPDATE transactions on the hot path.
 *
 * Race safety: both transactions re-check their invariants under the row
 * lock, so a stale snapshot can only cause a harmless extra no-op
 * transaction — never a missed grant. The answer only moves one way: a
 * ledger row never disappears and `freeNotesGrantedAt` only advances.
 */
export function decideBillingAccountMaintenance(input: {
  userId: string;
  snapshot: BillingAccountSnapshot | null;
  windowStart: Date;
}): BillingAccountMaintenance {
  const { userId, snapshot, windowStart } = input;
  if (!snapshot) {
    // Unknown user: downstream queries surface user_not_found themselves.
    return { needsInitialLedger: false, needsDailyFreeRefill: false };
  }
  return {
    needsInitialLedger: snapshot.notesBalance > 0 && !snapshot.hasLedgerRows,
    needsDailyFreeRefill:
      userId !== "guest"
      && snapshot.accountKind === "registered"
      && snapshot.freeNotesGrantedAt < windowStart,
  };
}

function objectField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const field = value[key];
  return field && typeof field === "object" && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : null;
}

function numberField(
  value: Record<string, unknown> | null,
  key: string,
): number | null {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
