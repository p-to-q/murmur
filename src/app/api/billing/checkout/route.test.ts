import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_checkout", email: "checkout@test.local", name: "Checkout Tester", avatarUrl: null },
  source: "session",
  sessionId: "sess_checkout",
};

const checkoutCreate = mock(async (payload: Record<string, unknown>) => {
  createdSessions.push(payload);
  return {
    sessionId: "cs_checkout_123",
    checkoutUrl: "https://checkout.waffo.test/session",
  };
});
const createdSessions: Array<Record<string, unknown>> = [];
let waffoConfigured = true;
let zpayConfigured = false;
const zpayCreateOrder = mock(async () => ({
  payUrl: "https://zpay.test/pay",
  tradeNo: "zpay_trade_123",
}));
const purchaseInserts: Array<Record<string, unknown>> = [];

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/billing/waffo", () => ({
  getWaffoClient: () =>
    waffoConfigured ? { checkout: { createSession: checkoutCreate } } : null,
  getWaffoTopupProductId: () => (waffoConfigured ? "PROD_test_topup" : null),
  isWaffoConfigured: () => waffoConfigured,
  centsToDisplayAmount: (cents: number) => (cents / 100).toFixed(2),
  displayAmountToCents: (amount: string) => Math.round(Number(amount) * 100),
}));

mock.module("@/lib/billing/zpay", () => ({
  isZpayConfigured: () => zpayConfigured,
  zpayCreateOrder,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        purchaseInserts.push(row);
        return Promise.resolve([]);
      },
    }),
  },
}));

const { POST } = await import("./route");

function buildRequest(body: Record<string, unknown>): NextRequest {
  return new Request("http://test.local/api/billing/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_checkout",
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(async () => {
  resetCachedRateLimitStore();
  await getRateLimitStore().resetAll();
  process.env.MURMUR_APP_URL = "http://test.local";
  nextAuth = {
    ok: true,
    user: { id: "usr_checkout", email: "checkout@test.local", name: "Checkout Tester", avatarUrl: null },
    source: "session",
    sessionId: "sess_checkout",
  };
  createdSessions.length = 0;
  purchaseInserts.length = 0;
  checkoutCreate.mockClear();
  zpayCreateOrder.mockClear();
  waffoConfigured = true;
  zpayConfigured = false;
});

describe("POST /api/billing/checkout", () => {
  it("creates a Waffo checkout session for a fixed SKU", async () => {
    const response = await POST(
      buildRequest({
        sku: "topup_120_notes",
        billingEmail: " Receipt@Test.Local ",
      }),
    );
    expect(response.status).toBe(200);
    expect(createdSessions).toHaveLength(1);
    expect(createdSessions[0]).toMatchObject({
      productId: "PROD_test_topup",
      currency: "USD",
      buyerEmail: "receipt@test.local",
      metadata: {
        userId: "usr_checkout",
        skuId: "topup_120_notes",
        notesGranted: "130",
        purchaseKind: "sku",
      },
      orderMerchantExternalId: expect.stringMatching(
        /^usr_checkout:topup_120_notes:/,
      ),
      successUrl: "http://test.local/topup/checkout?sku=topup_120_notes&currency=USD&status=success",
      priceSnapshot: { amount: "5.99", taxCategory: "digital_goods" },
    });
  });

  it("falls back to the signed-in account email when no billing email is supplied", async () => {
    const response = await POST(buildRequest({ sku: "topup_120_notes" }));
    expect(response.status).toBe(200);
    expect(createdSessions[0]).toMatchObject({
      buyerEmail: "checkout@test.local",
    });
  });

  it("rejects malformed billing emails", async () => {
    const response = await POST(
      buildRequest({ sku: "topup_120_notes", billingEmail: "not-an-email" }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_billing_email");
    expect(createdSessions).toHaveLength(0);
  });

  it("creates a Waffo checkout session for a custom amount", async () => {
    const response = await POST(buildRequest({ customAmountUsd: 12 }));
    expect(response.status).toBe(200);
    expect(createdSessions).toHaveLength(1);
    expect(createdSessions[0]).toMatchObject({
      metadata: {
        userId: "usr_checkout",
        skuId: "topup_custom",
        notesGranted: "240",
        purchaseKind: "custom",
        customAmountUsd: "12",
        customAmountCents: "1200",
      },
      successUrl: "http://test.local/topup/checkout?customAmountUsd=12&status=success",
      priceSnapshot: { amount: "12.00", taxCategory: "digital_goods" },
    });
  });

  it("keeps the billing email on pending Zpay purchases", async () => {
    zpayConfigured = true;

    const response = await POST(
      buildRequest({
        sku: "topup_120_notes",
        currency: "CNY",
        payMethod: "wxpay",
        billingEmail: "wechat-receipt@test.local",
      }),
    );

    expect(response.status).toBe(200);
    expect(zpayCreateOrder).toHaveBeenCalledTimes(1);
    expect(purchaseInserts).toHaveLength(1);
    expect(purchaseInserts[0]).toMatchObject({
      provider: "zpay",
      currency: "CNY",
      rawPayload: {
        payMethod: "wxpay",
        billingEmail: "wechat-receipt@test.local",
      },
    });
  });

  it("rejects explicit WeChat checkout when Zpay is not configured", async () => {
    const response = await POST(
      buildRequest({
        sku: "topup_120_notes",
        currency: "CNY",
        payMethod: "wxpay",
        billingEmail: "wechat-receipt@test.local",
      }),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("zpay_not_configured");
    expect(createdSessions).toHaveLength(0);
    expect(zpayCreateOrder).toHaveBeenCalledTimes(0);
    expect(purchaseInserts).toHaveLength(0);
  });

  it("rejects malformed topup requests", async () => {
    const response = await POST(buildRequest({ customAmountUsd: 0 }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_topup_request");
    expect(createdSessions).toHaveLength(0);
  });

  it("requires sign-in when Waffo is configured", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
      source: "guest",
      sessionId: "sess_guest",
    };
    const response = await POST(buildRequest({ sku: "topup_30_notes" }));
    expect(response.status).toBe(403);
  });

  it("rejects Local Creator sessions before checkout handoff", async () => {
    nextAuth = {
      ok: true,
      user: {
        id: "lc_checkout",
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: "sess_local",
    };

    const response = await POST(buildRequest({ sku: "topup_30_notes" }));

    expect(response.status).toBe(403);
    expect(createdSessions).toHaveLength(0);
  });

  it("answers 503 when Waffo is not configured", async () => {
    waffoConfigured = false;
    const response = await POST(buildRequest({ sku: "topup_30_notes" }));
    expect(response.status).toBe(503);
  });

  it("authenticates checkout requests before exposing provider configuration", async () => {
    waffoConfigured = false;
    nextAuth = {
      ok: false,
      response: new Response(JSON.stringify({ error: "auth_unavailable" }), {
        status: 401,
      }),
    };

    const response = await POST(buildRequest({ sku: "topup_30_notes" }));

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("auth_unavailable");
  });
});
