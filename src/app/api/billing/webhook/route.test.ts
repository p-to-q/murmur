import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { WebhookEventType } from "@waffo/pancake-ts";

let waffoConfigured = true;
let nextEvent: Record<string, unknown> | null = null;
let signatureError: Error | null = null;

const verifyWebhook = mock(() => {
  if (signatureError) throw signatureError;
  return nextEvent;
});

mock.module("@waffo/pancake-ts", () => ({
  verifyWebhook,
  WebhookEventType: {
    OrderCompleted: "order.completed",
    RefundSucceeded: "refund.succeeded",
  },
}));

mock.module("@/lib/billing/waffo", () => ({
  isWaffoConfigured: () => waffoConfigured,
  getWaffoClient: () => (waffoConfigured ? {} : null),
  getWaffoTopupProductId: () => "PROD_test",
  displayAmountToCents: (amount: string, currency: string) => {
    const value = Number(amount);
    return currency.toUpperCase() === "JPY" ? Math.round(value) : Math.round(value * 100);
  },
  centsToDisplayAmount: (cents: number, currency: string) =>
    currency.toUpperCase() === "JPY" ? String(cents) : (cents / 100).toFixed(2),
}));

type Row = Record<string, unknown>;
const eventInserts: Row[] = [];
const purchaseInserts: Row[] = [];
const eventUpdates: Row[] = [];
const purchaseUpdates: Row[] = [];
let eventInsertConflicts = false;
let reclaimRow: { id: string; status: string } | null = null;
let purchaseRow: Row | null = null;

function insertChain(values: Row) {
  const isEventRow = "providerEventId" in values;
  if (isEventRow) eventInserts.push(values);
  else purchaseInserts.push(values);

  const result = isEventRow && eventInsertConflicts ? [] : [{ id: values.id }];
  return {
    onConflictDoNothing: () => ({
      returning: async () => result,
      then: (resolve: (v: unknown) => void) => resolve(result),
    }),
  };
}

const dbMock = {
  insert: () => ({ values: (v: Row) => insertChain(v) }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          if (purchaseRow) return [purchaseRow];
          return reclaimRow ? [reclaimRow] : [];
        },
      }),
    }),
  }),
  update: () => ({
    set: (v: Row) => ({
      where: () => {
        if (v.status === "refunded") purchaseUpdates.push(v);
        else eventUpdates.push(v);
        return Promise.resolve([]);
      },
    }),
  }),
  transaction: async <T,>(fn: (tx: typeof dbMock) => Promise<T>): Promise<T> =>
    fn(dbMock),
};

mock.module("@/lib/db/client", () => ({ db: dbMock }));

const grantInputs: Row[] = [];
const reverseInputs: Row[] = [];
let grantResult: Row = {
  ok: true,
  ledgerId: "nle_test",
  balanceBefore: 5,
  balanceAfter: 135,
  duplicate: false,
};
let reverseResult: Row = {
  ok: true,
  ledgerId: "nle_refund",
  purchaseLedgerId: "nle_purchase",
  balanceBefore: 135,
  balanceAfter: 5,
  amount: 130,
  duplicate: false,
};

mock.module("@/lib/db/queries/notes-ledger", () => ({
  grantNotes: mock(async (input: Row) => {
    grantInputs.push(input);
    return grantResult;
  }),
  grantNotesInTransaction: mock(async (_tx: unknown, input: Row) => {
    grantInputs.push(input);
    return grantResult;
  }),
  getNotesBalance: async () => ({
    ok: true as const,
    userId: "guest",
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
  reverseTopupGrant: mock(async (input: Row) => {
    reverseInputs.push(input);
    return reverseResult;
  }),
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
}));

const { POST } = await import("./route");

function buildRequest(withSignature = true): NextRequest {
  return new Request("http://test.local/api/billing/webhook", {
    method: "POST",
    headers: withSignature ? { "x-waffo-signature": "sig_test" } : {},
    body: "{}",
  }) as unknown as NextRequest;
}

function orderCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh_deliv_1",
    eventType: WebhookEventType.OrderCompleted,
    mode: "test",
    data: {
      orderId: "ORD_test_123",
      buyerEmail: "buyer@test.local",
      currency: "USD",
      amount: "5.99",
      taxAmount: "0.00",
      productName: "Murmur Notes Top-up",
      paymentId: "PAY_test_123",
      orderMetadata: {
        userId: "usr_buyer",
        skuId: "topup_120_notes",
        notesGranted: "130",
      },
      ...overrides,
    },
  };
}

function refundSucceededEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh_refund_1",
    eventType: "refund.succeeded",
    eventId: "RF_test_123",
    mode: "test",
    data: {
      orderId: "ORD_test_123",
      buyerEmail: "buyer@test.local",
      currency: "USD",
      amount: "5.99",
      taxAmount: "0.00",
      productName: "Murmur Notes Top-up",
      refundStatus: "succeeded",
      refundReason: "requested_by_customer",
      refundTicketMerchantExternalId: "REF_ticket_123",
      ...overrides,
    },
  };
}

beforeEach(() => {
  waffoConfigured = true;
  nextEvent = orderCompletedEvent();
  signatureError = null;
  eventInsertConflicts = false;
  reclaimRow = { id: "evw_prior", status: "processed" };
  eventInserts.length = 0;
  purchaseInserts.length = 0;
  eventUpdates.length = 0;
  purchaseUpdates.length = 0;
  grantInputs.length = 0;
  reverseInputs.length = 0;
  purchaseRow = null;
  grantResult = {
    ok: true,
    ledgerId: "nle_test",
    balanceBefore: 5,
    balanceAfter: 135,
    duplicate: false,
  };
  reverseResult = {
    ok: true,
    ledgerId: "nle_refund",
    purchaseLedgerId: "nle_purchase",
    balanceBefore: 135,
    balanceAfter: 5,
    amount: 130,
    duplicate: false,
  };
  verifyWebhook.mockClear();
});

describe("POST /api/billing/webhook", () => {
  it("answers 503 when Waffo is not configured", async () => {
    waffoConfigured = false;
    const response = await POST(buildRequest());
    expect(response.status).toBe(503);
  });

  it("rejects requests without x-waffo-signature", async () => {
    const response = await POST(buildRequest(false));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("missing_signature");
  });

  it("rejects requests with an invalid signature", async () => {
    signatureError = new Error("bad signature");
    const response = await POST(buildRequest());
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_signature");
    expect(eventInserts).toHaveLength(0);
  });

  it("acknowledges duplicate events without re-granting", async () => {
    eventInsertConflicts = true;
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { duplicate?: boolean };
    expect(body.duplicate).toBe(true);
    expect(grantInputs).toHaveLength(0);
    expect(purchaseInserts).toHaveLength(0);
  });

  it("reprocesses a redelivered event whose first attempt failed", async () => {
    eventInsertConflicts = true;
    reclaimRow = { id: "evw_prior", status: "failed" };
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { granted?: number };
    expect(body.granted).toBe(130);
    expect(grantInputs).toHaveLength(1);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("records the purchase and grants notes for order.completed", async () => {
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { granted?: number };
    expect(body.granted).toBe(130);

    expect(purchaseInserts).toHaveLength(1);
    expect(purchaseInserts[0]).toMatchObject({
      userId: "usr_buyer",
      provider: "waffo",
      productId: "topup_120_notes",
      providerRef: "ORD_test_123",
      amountCents: 599,
      currency: "USD",
      notesGranted: 130,
      status: "succeeded",
    });

    expect(grantInputs).toHaveLength(1);
    expect(grantInputs[0]).toMatchObject({
      userId: "usr_buyer",
      amount: 130,
      reason: "purchase:topup",
      externalRef: "ORD_test_123",
    });

    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("records and grants custom topups from order metadata", async () => {
    nextEvent = orderCompletedEvent({
      amount: "12.00",
      orderMetadata: {
        userId: "usr_buyer",
        skuId: "topup_custom",
        notesGranted: "240",
        customAmountUsd: "12",
      },
    });

    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { granted?: number };
    expect(body.granted).toBe(240);

    expect(purchaseInserts[0]).toMatchObject({
      productId: "topup_custom",
      amountCents: 1200,
      notesGranted: 240,
    });

    expect(grantInputs[0]).toMatchObject({
      metadata: {
        provider: "waffo",
        skuId: "topup_custom",
        customAmountUsd: 12,
      },
    });
  });

  it("reverses notes and marks purchases refunded for refund.succeeded", async () => {
    nextEvent = refundSucceededEvent();
    purchaseRow = {
      id: "pur_test",
      userId: "usr_buyer",
      productId: "topup_120_notes",
      amountCents: 599,
      currency: "USD",
      notesGranted: 130,
      status: "succeeded",
    };

    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { refunded?: number };
    expect(body.refunded).toBe(130);

    expect(reverseInputs).toHaveLength(1);
    expect(reverseInputs[0]).toMatchObject({
      userId: "usr_buyer",
      orderId: "ORD_test_123",
      notesGranted: 130,
      refundExternalRef: "waffo-refund:REF_ticket_123",
    });

    expect(purchaseUpdates.at(-1)).toMatchObject({ status: "refunded" });
    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("falls back to the refund event id when no refund ticket ref is present", async () => {
    nextEvent = refundSucceededEvent({ refundTicketMerchantExternalId: undefined });
    purchaseRow = {
      id: "pur_test",
      userId: "usr_buyer",
      productId: "topup_120_notes",
      amountCents: 599,
      currency: "USD",
      notesGranted: 130,
      status: "succeeded",
    };

    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    expect(reverseInputs[0]).toMatchObject({
      refundExternalRef: "waffo-refund:RF_test_123",
    });
  });

  it("acknowledges already-refunded purchases without reversing notes again", async () => {
    nextEvent = refundSucceededEvent({ refundTicketMerchantExternalId: "REF_later_duplicate" });
    purchaseRow = {
      id: "pur_test",
      userId: "usr_buyer",
      productId: "topup_120_notes",
      notesGranted: 130,
      status: "refunded",
    };

    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { refunded?: number; duplicate?: boolean };
    expect(body.refunded).toBe(0);
    expect(body.duplicate).toBe(true);
    expect(reverseInputs).toHaveLength(0);
    expect(purchaseUpdates).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("does not auto-reverse notes for partial refund.succeeded amounts", async () => {
    nextEvent = refundSucceededEvent({ amount: "2.00" });
    purchaseRow = {
      id: "pur_test",
      userId: "usr_buyer",
      productId: "topup_120_notes",
      amountCents: 599,
      currency: "USD",
      notesGranted: 130,
      status: "succeeded",
    };

    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      manualReview?: boolean;
      risk?: string;
      refundAmountCents?: number;
      purchaseAmountCents?: number;
    };
    expect(body.manualReview).toBe(true);
    expect(body.risk).toBe("partial_refund_not_supported");
    expect(body.refundAmountCents).toBe(200);
    expect(body.purchaseAmountCents).toBe(599);
    expect(reverseInputs).toHaveLength(0);
    expect(purchaseUpdates).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("marks malformed orders failed but acknowledges them", async () => {
    nextEvent = orderCompletedEvent({ orderMetadata: {} });
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("non_retryable");
    expect(grantInputs).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("returns 500 when the grant fails", async () => {
    grantResult = { ok: false, reason: "user_not_found" };
    const response = await POST(buildRequest());
    expect(response.status).toBe(500);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("ignores unrelated event types", async () => {
    nextEvent = { id: "wh_2", eventType: "subscription.activated", data: {} };
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ignored?: string };
    expect(body.ignored).toBe("subscription.activated");
    expect(grantInputs).toHaveLength(0);
  });
});
