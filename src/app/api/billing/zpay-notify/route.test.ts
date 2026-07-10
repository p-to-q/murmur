import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

let zpayConfigured = true;
let verifiedNotify: Record<string, string> | null = null;
let pendingPurchase: {
  id: string;
  userId: string;
  productId: string;
  notesGranted: number;
  amountCents: number;
  currency: string;
  status: string;
} | null = null;
let eventInsertConflicts = false;
let reclaimedEvent: { id: string; status: string } | null = null;
let selectCalls = 0;

const eventInserts: Array<Record<string, unknown>> = [];
const eventUpdates: Array<Record<string, unknown>> = [];
const purchaseUpdates: Array<Record<string, unknown>> = [];
const grantInputs: Array<Record<string, unknown>> = [];

mock.module("@/lib/billing/zpay", () => ({
  isZpayConfigured: () => zpayConfigured,
  zpayCreateOrder: mock(async () => ({
    payUrl: "https://zpay.test/pay",
    tradeNo: "trade_zpay_1",
  })),
  zpayVerifyNotify: () => verifiedNotify,
}));

const dbMock = {
  insert: () => ({
    values: (row: Record<string, unknown>) => {
      eventInserts.push(row);
      return {
        onConflictDoNothing: () => ({
          returning: async () => (eventInsertConflicts ? [] : [{ id: "evw_zpay" }]),
        }),
      };
    },
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          selectCalls += 1;
          if (eventInsertConflicts && selectCalls === 1) {
            return reclaimedEvent ? [reclaimedEvent] : [];
          }
          return pendingPurchase ? [pendingPurchase] : [];
        },
      }),
    }),
  }),
  update: () => ({
    set: (row: Record<string, unknown>) => ({
      where: async () => {
        if ("rawPayload" in row || row.status === "succeeded") purchaseUpdates.push(row);
        else eventUpdates.push(row);
        return [];
      },
    }),
  }),
  transaction: async <T,>(fn: (tx: typeof dbMock) => Promise<T>): Promise<T> => fn(dbMock),
};

mock.module("@/lib/db/client", () => ({ db: dbMock }));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  grantNotes: mock(async (input: Record<string, unknown>) => {
    grantInputs.push(input);
    return {
      ok: true as const,
      ledgerId: "nle_zpay",
      balanceBefore: 0,
      balanceAfter: input.amount,
      duplicate: false,
    };
  }),
  grantNotesInTransaction: mock(async () => ({
    ok: true as const,
    ledgerId: "nle_zpay_tx",
    balanceBefore: 0,
    balanceAfter: 0,
    duplicate: false,
  })),
  getNotesBalance: async () => ({
    ok: true as const,
    userId: "usr_zpay",
    notes: 0,
    accountNotes: 0,
    dailyFreeNotes: 0,
    planTier: "free" as const,
    freeNotesGrantedAt: new Date("2026-06-05T00:00:00.000Z"),
  }),
  spendNotes: async () => ({
    ok: false as const,
    reason: "user_not_found" as const,
    currentBalance: 0,
  }),
  refundNotes: async () => ({
    ok: false as const,
    reason: "original_not_found" as const,
  }),
  reverseTopupGrant: async () => ({
    ok: false as const,
    reason: "purchase_grant_not_found" as const,
  }),
  decideGrant: () => ({ kind: "grant", balanceAfter: 0 }),
  decideSpend: () => ({ kind: "insufficient", currentBalance: 0 }),
  decideRefund: () => ({ kind: "original_missing" }),
  decideSpendPoolsForCost: () => ({
    dailyFreeBefore: 0,
    accountBefore: 0,
    dailyFreeSpent: 0,
    accountSpent: 0,
    dailyFreeAfter: 0,
    accountAfter: 0,
  }),
  decideRefundPoolsForOriginalSpend: () => ({
    dailyFreeRestore: 0,
    accountRestore: 0,
    dailyFreeAfter: 0,
    accountAfter: 0,
  }),
  accountNotesFromTotal: (total: number, dailyFree: number) => Math.max(0, total - dailyFree),
  trimDailyFreeAfterTopupReversal: (dailyFree: number, total: number) => Math.min(dailyFree, total),
  refundReferenceFor: (id: string) => `refund:${id}`,
}));

const { POST } = await import("./route");

beforeEach(() => {
  zpayConfigured = true;
  verifiedNotify = {
    trade_status: "TRADE_SUCCESS",
    out_trade_no: "usr_zpay:topup_120_notes:order_1",
    trade_no: "trade_zpay_1",
    type: "wxpay",
    money: "42.90",
    pid: "pid_test",
    name: "Murmur",
    sign: "sig",
    sign_type: "MD5",
  };
  pendingPurchase = {
    id: "pur_zpay",
    userId: "usr_zpay",
    productId: "topup_120_notes",
    notesGranted: 130,
    amountCents: 4290,
    currency: "CNY",
    status: "pending",
  };
  eventInsertConflicts = false;
  reclaimedEvent = null;
  selectCalls = 0;
  eventInserts.length = 0;
  eventUpdates.length = 0;
  purchaseUpdates.length = 0;
  grantInputs.length = 0;
});

function request(): NextRequest {
  return requestWithBody("ignored=1");
}

function requestWithBody(body: string): NextRequest {
  return new Request("http://test.local/api/billing/zpay-notify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }) as unknown as NextRequest;
}

describe("POST /api/billing/zpay-notify", () => {
  it("grants notes when the paid amount matches the pending purchase", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("success");
    expect(grantInputs).toHaveLength(1);
    expect(grantInputs[0]).toMatchObject({
      userId: "usr_zpay",
      amount: 130,
      reason: "purchase:topup",
      externalRef: "usr_zpay:topup_120_notes:order_1",
    });
    expect(purchaseUpdates.at(-1)).toMatchObject({ status: "succeeded" });
    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("rejects amount mismatches before granting notes", async () => {
    verifiedNotify = {
      ...verifiedNotify!,
      money: "0.01",
    };

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("success");
    expect(grantInputs).toHaveLength(0);
    expect(purchaseUpdates).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({
      status: "failed",
      error: "amount mismatch",
    });
  });

  it("rejects invalid amount formats before granting notes", async () => {
    verifiedNotify = {
      ...verifiedNotify!,
      money: "42.900",
    };

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("success");
    expect(grantInputs).toHaveLength(0);
    expect(purchaseUpdates).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({
      status: "failed",
      error: "amount mismatch",
    });
  });

  it("does not grant notes for non-pending purchases", async () => {
    pendingPurchase = {
      ...pendingPurchase!,
      status: "refunded",
    };

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("success");
    expect(grantInputs).toHaveLength(0);
    expect(purchaseUpdates).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({
      status: "failed",
      error: "invalid purchase status",
    });
  });

  it("acknowledges already succeeded purchases without regranting", async () => {
    pendingPurchase = {
      ...pendingPurchase!,
      status: "succeeded",
    };

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("success");
    expect(grantInputs).toHaveLength(0);
    expect(purchaseUpdates).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("rejects out_trade_no values that do not match the pending purchase", async () => {
    pendingPurchase = {
      ...pendingPurchase!,
      userId: "usr_other",
    };

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("success");
    expect(grantInputs).toHaveLength(0);
    expect(purchaseUpdates).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({
      status: "failed",
      error: "purchase mismatch",
    });
  });

  it("rejects duplicate form keys before recording a webhook event", async () => {
    const response = await POST(requestWithBody("money=42.90&money=0.01"));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("fail");
    expect(eventInserts).toHaveLength(0);
    expect(grantInputs).toHaveLength(0);
  });

  it("reprocesses a redelivered notification after an earlier failed attempt", async () => {
    eventInsertConflicts = true;
    reclaimedEvent = { id: "evw_failed_zpay", status: "failed" };

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("success");
    expect(grantInputs).toHaveLength(1);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("acknowledges already processed duplicate notifications without regranting", async () => {
    eventInsertConflicts = true;
    reclaimedEvent = { id: "evw_done_zpay", status: "processed" };

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("success");
    expect(grantInputs).toHaveLength(0);
    expect(eventUpdates).toHaveLength(0);
  });
});
