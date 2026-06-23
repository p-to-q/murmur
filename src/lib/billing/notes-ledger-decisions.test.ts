import { describe, expect, it } from "bun:test";
import {
  accountNotesFromTotal,
  dailyFreeAfterGrant,
  decideGrant,
  decideRefund,
  decideRefundPoolsForOriginalSpend,
  decideSpend,
  decideSpendPoolsForCost,
  decideTopupReversal,
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
  it("fully reverses the purchased amount even when the balance goes negative", () => {
    const result = decideTopupReversal({
      currentBalance: 2,
      amount: 130,
      existingRefund: null,
    });

    expect(result).toEqual({
      kind: "proceed",
      balanceAfter: -128,
      amount: 130,
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
