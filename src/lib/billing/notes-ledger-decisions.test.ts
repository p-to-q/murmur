import { describe, expect, it } from "bun:test";
import {
  accountNotesFromTotal,
  dailyFreeAfterGrant,
  decideBillingAccountMaintenance,
  decideGrant,
  decideOperationDelivery,
  decideRechargePoolsForOriginalSpend,
  decideRefund,
  decideRefundPoolsForOriginalSpend,
  decideSpend,
  decideSpendPoolsForCost,
  decideTopupReversal,
  deliveredReferenceFor,
  deriveOperationState,
  originalLedgerIdFromPendingRef,
  pendingRefundReferenceFor,
  rechargeReferenceFor,
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

describe("operation state machine (#298)", () => {
  describe("decideRefund delivery-awareness", () => {
    it("skips the refund for a delivered operation instead of reversing it", () => {
      // A reconcile pass hitting a pending marker whose operation was delivered
      // must NOT refund the delivered work.
      const result = decideRefund({
        currentBalance: 4,
        original: { id: "nle_spend", delta: -1 },
        existingRefund: null,
        delivered: true,
      });
      expect(result).toEqual({ kind: "delivered", amount: 1 });
    });

    it("still reports duplicate when a refund already exists, even if delivered", () => {
      // failure → refund → retry-delivered → re-charged. The refund row exists,
      // so a later reconcile dedupes on it (balance already correct) rather than
      // taking the delivered no-op path.
      const result = decideRefund({
        currentBalance: 7,
        original: { id: "nle_spend", delta: -1 },
        existingRefund: { id: "nle_refund_prior", delta: 1 },
        delivered: true,
      });
      expect(result).toEqual({
        kind: "duplicate",
        ledgerId: "nle_refund_prior",
        balanceAfter: 7,
        amount: 1,
      });
    });

    it("proceeds normally for a not-yet-delivered failed operation", () => {
      const result = decideRefund({
        currentBalance: 4,
        original: { id: "nle_spend", delta: -1 },
        existingRefund: null,
        delivered: false,
      });
      expect(result).toEqual({ kind: "proceed", balanceAfter: 5, amount: 1 });
    });
  });

  describe("deriveOperationState", () => {
    it("maps row existence to the five named states", () => {
      const base = { hasSpend: true, hasRefund: false, hasPending: false, hasDelivered: false };
      expect(deriveOperationState(base)).toBe("charged");
      expect(deriveOperationState({ ...base, hasPending: true })).toBe("refund_pending");
      expect(deriveOperationState({ ...base, hasRefund: true })).toBe("refunded");
      // delivered is terminal and wins over any compensation rows.
      expect(deriveOperationState({ ...base, hasRefund: true, hasDelivered: true })).toBe("delivered");
      expect(deriveOperationState({ ...base, hasPending: true, hasDelivered: true })).toBe("delivered");
    });
  });

  describe("references", () => {
    it("builds distinct, deterministic recharge and delivered refs", () => {
      expect(rechargeReferenceFor("nle_1")).toBe("recharge:nle_1");
      expect(deliveredReferenceFor("nle_1")).toBe("op_delivered:nle_1");
      // Each role's ref is disjoint from the others for the same spend id, so a
      // single IN (...) lookup classifies rows by ref unambiguously.
      const refs = new Set([
        refundReferenceFor("nle_1"),
        pendingRefundReferenceFor("nle_1"),
        rechargeReferenceFor("nle_1"),
        deliveredReferenceFor("nle_1"),
      ]);
      expect(refs.size).toBe(4);
    });
  });

  describe("decideOperationDelivery", () => {
    const spend = { delta: -1, metadata: { spendPools: { dailyFreeSpent: 1, accountSpent: 0 } } };

    it("is a replay no-op once the delivered marker exists", () => {
      expect(
        decideOperationDelivery({
          spend,
          hasRefund: true,
          hasDelivered: true,
          hasRecharge: true,
          currentBalance: 4,
          currentDailyFree: 0,
        }),
      ).toEqual({ kind: "already_delivered" });
    });

    it("records delivery without a re-charge on the happy path (never compensated)", () => {
      // charged → delivered: balance already reflects the single charge.
      expect(
        decideOperationDelivery({
          spend,
          hasRefund: false,
          hasDelivered: false,
          hasRecharge: false,
          currentBalance: 4,
          currentDailyFree: 1,
        }),
      ).toEqual({
        kind: "delivered",
        writeDelivered: true,
        writeRecharge: false,
        balanceAfter: 4,
        dailyFreeAfter: 1,
      });
    });

    it("records delivery without a re-charge for a pending-only operation", () => {
      // refund write failed → balance was never actually reversed (still one
      // charge). Recording delivery makes refundNotes/reconcile skip the owed
      // refund; no balance change.
      expect(
        decideOperationDelivery({
          spend,
          hasRefund: false,
          hasDelivered: false,
          hasRecharge: false,
          currentBalance: 4,
          currentDailyFree: 0,
        }),
      ).toMatchObject({
        kind: "delivered",
        writeRecharge: false,
        balanceAfter: 4,
      });
    });

    it("re-charges when a completed refund had reversed the spend", () => {
      // failure → refund (balance restored to 5) → retry delivered: re-charge
      // back to one net charge (balance 4), re-spending the same daily-free note.
      const decision = decideOperationDelivery({
        spend,
        hasRefund: true,
        hasDelivered: false,
        hasRecharge: false,
        currentBalance: 5,
        currentDailyFree: 1,
      });
      expect(decision).toMatchObject({
        kind: "delivered_recharged",
        writeDelivered: true,
        writeRecharge: true,
        rechargeAmount: 1,
        balanceAfter: 4,
        dailyFreeAfter: 0,
      });
    });

    it("does not re-charge twice when the recharge row already exists", () => {
      const decision = decideOperationDelivery({
        spend,
        hasRefund: true,
        hasDelivered: false,
        hasRecharge: true,
        currentBalance: 4,
        currentDailyFree: 0,
      });
      expect(decision).toMatchObject({ kind: "delivered", writeRecharge: false, balanceAfter: 4 });
    });
  });

  describe("decideRechargePoolsForOriginalSpend", () => {
    it("re-spends exactly the daily-free portion the refund had restored (pool-neutral round trip)", () => {
      // Original spend took 1 daily-free note; the refund restored it (dailyFree
      // back to 1). The recharge re-spends that 1 so the net daily-free is 0.
      expect(
        decideRechargePoolsForOriginalSpend(
          { spendPools: { dailyFreeSpent: 1, accountSpent: 0 } },
          1,
          0,
        ),
      ).toEqual({
        dailyFreeReSpent: 1,
        accountReSpent: 0,
        dailyFreeAfter: 0,
        accountAfter: 0,
      });
    });

    it("re-spends from the account pool when the original spend did", () => {
      expect(
        decideRechargePoolsForOriginalSpend(
          { spendPools: { dailyFreeSpent: 0, accountSpent: 1 } },
          0,
          4,
        ),
      ).toEqual({
        dailyFreeReSpent: 0,
        accountReSpent: 1,
        dailyFreeAfter: 0,
        accountAfter: 4,
      });
    });
  });

  describe("net-charge invariant across the four acceptance cases", () => {
    // Each case walks the operation's ledger deltas through the decisions and
    // asserts the operation nets to exactly one charge for delivered work, zero
    // for reversed work. cost = 1.
    function netOf(deltas: number[]): number {
      return deltas.reduce((a, b) => a + b, 0);
    }

    it("response lost after delivery → replay does not double charge", () => {
      // Stable op id: the replayed spend dedupes (no new row). Delivered, never
      // compensated → no recharge.
      const spendDelta = -1;
      const delivery = decideOperationDelivery({
        spend: { delta: spendDelta, metadata: {} },
        hasRefund: false,
        hasDelivered: false,
        hasRecharge: false,
        currentBalance: 4,
        currentDailyFree: 0,
      });
      expect(delivery).toMatchObject({ writeRecharge: false });
      // One spend row only across both attempts (replay is a ledger duplicate).
      expect(netOf([spendDelta])).toBe(-1);
    });

    it("worker failure → refund → retry success has exactly one net charge", () => {
      const spendDelta = -1;
      const refund = decideRefund({
        currentBalance: 4,
        original: { id: "s", delta: spendDelta },
        existingRefund: null,
        delivered: false,
      });
      expect(refund.kind).toBe("proceed");
      const refundDelta = refund.kind === "proceed" ? refund.amount : 0; // +1
      // Retry delivers: a completed refund exists → re-charge.
      const delivery = decideOperationDelivery({
        spend: { delta: spendDelta, metadata: {} },
        hasRefund: true,
        hasDelivered: false,
        hasRecharge: false,
        currentBalance: 5,
        currentDailyFree: 0,
      });
      const rechargeDelta =
        delivery.kind === "delivered_recharged" ? -delivery.rechargeAmount : 0; // -1
      expect(netOf([spendDelta, refundDelta, rechargeDelta])).toBe(-1);
    });

    it("refund pending → retry success → reconcile does not refund delivered work", () => {
      const spendDelta = -1;
      // Pending marker is zero-delta; balance is still one net charge.
      // Delivery records the delivered marker; no recharge (never truly reversed).
      const delivery = decideOperationDelivery({
        spend: { delta: spendDelta, metadata: {} },
        hasRefund: false,
        hasDelivered: false,
        hasRecharge: false,
        currentBalance: 4,
        currentDailyFree: 0,
      });
      expect(delivery).toMatchObject({ writeRecharge: false });
      // Reconcile now runs refundNotes on the pending marker → delivered → skip.
      const reconcile = decideRefund({
        currentBalance: 4,
        original: { id: "s", delta: spendDelta },
        existingRefund: null,
        delivered: true,
      });
      expect(reconcile.kind).toBe("delivered");
      const reconcileDelta = 0; // skipped
      expect(netOf([spendDelta, 0 /* pending */, reconcileDelta])).toBe(-1);
    });

    it("concurrent retries settle to one coherent net charge", () => {
      const spendDelta = -1;
      // Two deliveries race. The first settles (delivered marker); the second
      // sees it and is a replay no-op.
      const first = decideOperationDelivery({
        spend: { delta: spendDelta, metadata: {} },
        hasRefund: false,
        hasDelivered: false,
        hasRecharge: false,
        currentBalance: 4,
        currentDailyFree: 0,
      });
      const second = decideOperationDelivery({
        spend: { delta: spendDelta, metadata: {} },
        hasRefund: false,
        hasDelivered: true, // first already wrote the marker
        hasRecharge: false,
        currentBalance: 4,
        currentDailyFree: 0,
      });
      expect(first).toMatchObject({ writeDelivered: true, writeRecharge: false });
      expect(second).toEqual({ kind: "already_delivered" });
      expect(netOf([spendDelta])).toBe(-1);
    });
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
