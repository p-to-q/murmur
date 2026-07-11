import { describe, expect, it } from "bun:test";
import {
  accountNotesFromTotal,
  dailyFreeAfterGrant,
  decideBillingAccountMaintenance,
  decideGrant,
  decideRefund,
  decideRefundPoolsForOriginalSpend,
  decideSpend,
  decideSpendPoolsForCost,
  decideTopupReversal,
  originalLedgerIdFromPendingRef,
  pendingRefundReferenceFor,
  refundReferenceFor,
  trimDailyFreeAfterTopupReversal,
} from "@/lib/billing/notes-ledger-decisions";

describe("decideSpend", () => {
  it("returns duplicate when an existing ledger row is provided (idempotency replay)", () => {
    const result = decideSpend({
      currentBalance: 7,
      cost: 3,
      existing: { id: "nle_prior", delta: -3 },
    });
    expect(result).toEqual({
      kind: "duplicate",
      ledgerId: "nle_prior",
      balanceBefore: 7,
      balanceAfter: 7,
    });
  });

  it("returns insufficient when current balance is below cost", () => {
    const result = decideSpend({ currentBalance: 2, cost: 5, existing: null });
    expect(result).toEqual({ kind: "insufficient", currentBalance: 2 });
  });

  it("returns proceed when balance exactly matches cost", () => {
    const result = decideSpend({ currentBalance: 5, cost: 5, existing: null });
    expect(result).toEqual({ kind: "proceed", balanceAfter: 0 });
  });

  it("returns proceed and computes balanceAfter correctly when balance exceeds cost", () => {
    const result = decideSpend({ currentBalance: 12, cost: 4, existing: null });
    expect(result).toEqual({ kind: "proceed", balanceAfter: 8 });
  });

  it("prefers duplicate over insufficient when both apply", () => {
    // A replayed spend that originally succeeded but now finds the
    // balance depleted (e.g. due to concurrent spends) must still
    // return duplicate so the caller treats the call as a no-op.
    const result = decideSpend({
      currentBalance: 0,
      cost: 10,
      existing: { id: "nle_prior", delta: -10 },
    });
    expect(result.kind).toBe("duplicate");
  });
});

describe("decideGrant", () => {
  it("returns duplicate when an existing ledger row is provided", () => {
    const result = decideGrant({
      currentBalance: 5,
      amount: 10,
      existing: { id: "nle_prior", delta: 10 },
    });
    expect(result).toEqual({
      kind: "duplicate",
      ledgerId: "nle_prior",
      balanceBefore: 5,
      balanceAfter: 5,
    });
  });

  it("returns proceed and computes balanceAfter correctly", () => {
    const result = decideGrant({ currentBalance: 5, amount: 10, existing: null });
    expect(result).toEqual({ kind: "proceed", balanceAfter: 15 });
  });
});

describe("decideRefund", () => {
  it("returns original_missing when the source ledger row is absent", () => {
    const result = decideRefund({
      currentBalance: 0,
      original: null,
      existingRefund: null,
    });
    expect(result).toEqual({ kind: "original_missing" });
  });

  it("returns original_not_spend when the source row is a positive-delta grant", () => {
    const result = decideRefund({
      currentBalance: 0,
      original: { id: "nle_grant", delta: 10 },
      existingRefund: null,
    });
    expect(result).toEqual({ kind: "original_not_spend" });
  });

  it("returns original_not_spend for a zero-delta row", () => {
    // Belt-and-suspenders: a zero-delta row is degenerate but
    // shouldn't trigger a refund either.
    const result = decideRefund({
      currentBalance: 0,
      original: { id: "nle_zero", delta: 0 },
      existingRefund: null,
    });
    expect(result).toEqual({ kind: "original_not_spend" });
  });

  it("returns duplicate when a matching refund row already exists", () => {
    const result = decideRefund({
      currentBalance: 7,
      original: { id: "nle_spend", delta: -3 },
      existingRefund: { id: "nle_refund_prior", delta: 3 },
    });
    expect(result).toEqual({
      kind: "duplicate",
      ledgerId: "nle_refund_prior",
      balanceAfter: 7,
      amount: 3,
    });
  });

  it("returns proceed with positive amount equal to |original.delta|", () => {
    const result = decideRefund({
      currentBalance: 4,
      original: { id: "nle_spend", delta: -3 },
      existingRefund: null,
    });
    expect(result).toEqual({
      kind: "proceed",
      balanceAfter: 7,
      amount: 3,
    });
  });
});

describe("refundReferenceFor", () => {
  it("produces a deterministic refund:<id> external_ref", () => {
    expect(refundReferenceFor("nle_abc")).toBe("refund:nle_abc");
  });

  it("is collision-free across distinct ledger ids", () => {
    expect(refundReferenceFor("nle_a")).not.toBe(refundReferenceFor("nle_b"));
  });
});

describe("decideTopupReversal", () => {
  it("clamps the reversal so the balance never goes negative (#233)", () => {
    // Buyer purchased 130 notes, then spent all but 2 before the refund.
    // Clawing back the full 130 would drive the balance to -128 and lock the
    // account out of every future spend; clamp to what is still on the balance.
    const result = decideTopupReversal({
      currentBalance: 2,
      amount: 130,
      existingRefund: null,
    });

    expect(result).toEqual({
      kind: "proceed",
      amount: 2,
      balanceAfter: 0,
      clamped: true,
      unrefunded: 128,
    });
  });

  it("reverses the full amount when the balance still covers it", () => {
    const result = decideTopupReversal({
      currentBalance: 200,
      amount: 130,
      existingRefund: null,
    });

    expect(result).toEqual({
      kind: "proceed",
      amount: 130,
      balanceAfter: 70,
      clamped: false,
      unrefunded: 0,
    });
  });

  it("claws back nothing (but never errors) when the balance is already in debt", () => {
    const result = decideTopupReversal({
      currentBalance: -5,
      amount: 130,
      existingRefund: null,
    });

    expect(result).toEqual({
      kind: "proceed",
      amount: 0,
      balanceAfter: -5,
      clamped: true,
      unrefunded: 130,
    });
  });

  it("returns duplicate when the refund reference already has a ledger row", () => {
    const result = decideTopupReversal({
      currentBalance: -128,
      amount: 130,
      existingRefund: { id: "nle_refund_prior", delta: -130 },
    });

    expect(result).toEqual({
      kind: "duplicate",
      ledgerId: "nle_refund_prior",
      balanceAfter: -128,
      amount: 130,
    });
  });
});

describe("pending-refund references (#232)", () => {
  it("builds a stable refund_pending:<id> external_ref", () => {
    expect(pendingRefundReferenceFor("nle_spend_1")).toBe("refund_pending:nle_spend_1");
  });

  it("round-trips the original ledger id out of a pending ref", () => {
    const ref = pendingRefundReferenceFor("nle_spend_1");
    expect(originalLedgerIdFromPendingRef(ref)).toBe("nle_spend_1");
  });

  it("does not confuse a settled refund:<id> ref for a pending marker", () => {
    // refund:<id> (the real reversal) must not parse as a pending marker.
    expect(originalLedgerIdFromPendingRef(refundReferenceFor("nle_spend_1"))).toBeNull();
    expect(originalLedgerIdFromPendingRef(null)).toBeNull();
    expect(originalLedgerIdFromPendingRef("refund_pending:")).toBeNull();
  });
});

describe("daily-free pool decisions", () => {
  it("derives account notes from total notes without double counting daily-free notes", () => {
    expect(accountNotesFromTotal(15, 5)).toBe(10);
    expect(accountNotesFromTotal(3, 9)).toBe(0);
  });

  it("spends daily-free notes before account notes", () => {
    expect(decideSpendPoolsForCost({
      notesBalance: 15,
      dailyFreeNotesBalance: 5,
    }, 3)).toEqual({
      dailyFreeBefore: 5,
      accountBefore: 10,
      dailyFreeSpent: 3,
      accountSpent: 0,
      dailyFreeAfter: 2,
      accountAfter: 10,
    });
  });

  it("spends account notes only after the daily-free pool is empty", () => {
    expect(decideSpendPoolsForCost({
      notesBalance: 15,
      dailyFreeNotesBalance: 2,
    }, 5)).toEqual({
      dailyFreeBefore: 2,
      accountBefore: 13,
      dailyFreeSpent: 2,
      accountSpent: 3,
      dailyFreeAfter: 0,
      accountAfter: 10,
    });
  });

  it("restores the daily-free portion of a refunded spend", () => {
    const result = decideRefundPoolsForOriginalSpend(
      {
        spendPools: {
          dailyFreeSpent: 2,
          accountSpent: 3,
        },
      },
      1,
      15,
      10,
    );

    expect(result).toEqual({
      dailyFreeRestore: 2,
      accountRestore: 3,
      dailyFreeAfter: 3,
      accountAfter: 12,
    });
  });

  it("trims daily-free notes when a top-up reversal shrinks the total balance", () => {
    expect(trimDailyFreeAfterTopupReversal(8, 3)).toBe(3);
  });

  it("applies daily-free grants to debt before making them spendable", () => {
    expect(dailyFreeAfterGrant({
      currentBalance: -4,
      currentDailyFree: 0,
      grantAmount: 3,
      maxDailyFreeBalance: 10,
    })).toBe(0);

    expect(dailyFreeAfterGrant({
      currentBalance: -2,
      currentDailyFree: 0,
      grantAmount: 5,
      maxDailyFreeBalance: 10,
    })).toBe(3);
  });
});

describe("decideBillingAccountMaintenance", () => {
  const windowStart = new Date("2026-07-08T16:00:00.000Z");
  const settledSnapshot = {
    notesBalance: 12,
    accountKind: "registered",
    freeNotesGrantedAt: new Date("2026-07-08T16:00:00.001Z"),
    hasLedgerRows: true,
  };

  it("skips both transactions for a settled account (the hot path)", () => {
    expect(decideBillingAccountMaintenance({
      userId: "usr_1",
      snapshot: settledSnapshot,
      windowStart,
    })).toEqual({ needsInitialLedger: false, needsDailyFreeRefill: false });
  });

  it("skips both transactions for an unknown user", () => {
    expect(decideBillingAccountMaintenance({
      userId: "usr_missing",
      snapshot: null,
      windowStart,
    })).toEqual({ needsInitialLedger: false, needsDailyFreeRefill: false });
  });

  it("requests the initial-ledger backfill only for a positive balance with no ledger rows", () => {
    expect(decideBillingAccountMaintenance({
      userId: "usr_1",
      snapshot: { ...settledSnapshot, hasLedgerRows: false },
      windowStart,
    }).needsInitialLedger).toBe(true);

    expect(decideBillingAccountMaintenance({
      userId: "usr_1",
      snapshot: { ...settledSnapshot, notesBalance: 0, hasLedgerRows: false },
      windowStart,
    }).needsInitialLedger).toBe(false);
  });

  it("requests the daily refill when the last grant predates the current window", () => {
    expect(decideBillingAccountMaintenance({
      userId: "usr_1",
      snapshot: {
        ...settledSnapshot,
        freeNotesGrantedAt: new Date("2026-07-07T16:00:00.000Z"),
      },
      windowStart,
    }).needsDailyFreeRefill).toBe(true);
  });

  it("treats a grant timestamp equal to the window start as already refilled", () => {
    expect(decideBillingAccountMaintenance({
      userId: "usr_1",
      snapshot: { ...settledSnapshot, freeNotesGrantedAt: windowStart },
      windowStart,
    }).needsDailyFreeRefill).toBe(false);
  });

  it("never requests the daily refill for guests or local creators", () => {
    const stale = new Date("2026-07-01T16:00:00.000Z");
    expect(decideBillingAccountMaintenance({
      userId: "guest",
      snapshot: { ...settledSnapshot, freeNotesGrantedAt: stale },
      windowStart,
    }).needsDailyFreeRefill).toBe(false);

    expect(decideBillingAccountMaintenance({
      userId: "usr_1",
      snapshot: {
        ...settledSnapshot,
        accountKind: "local_creator",
        freeNotesGrantedAt: stale,
      },
      windowStart,
    }).needsDailyFreeRefill).toBe(false);
  });
});
