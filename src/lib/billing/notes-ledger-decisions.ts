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

/**
 * Deterministic external_ref string a refund writes so the
 * unique-partial idempotency index dedupes duplicate refund attempts
 * targeting the same original spend.
 */
export function refundReferenceFor(originalLedgerId: string): string {
  return `refund:${originalLedgerId}`;
}
