import { describe, expect, it } from "bun:test";
import {
  decideGrant,
  decideRefund,
  decideSpend,
  refundReferenceFor,
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
