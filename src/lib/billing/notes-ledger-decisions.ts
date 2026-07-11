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
  | { kind: "proceed"; balanceAfter: number; amount: number }
  | { kind: "original_missing" }
  | { kind: "original_not_spend" };

export function decideRefund(input: {
  currentBalance: number;
  original: { id: string; delta: number } | null;
  existingRefund: ExistingLedgerRow | null;
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
