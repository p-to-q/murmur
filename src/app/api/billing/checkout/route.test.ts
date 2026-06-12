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
  return { id: "cs_checkout_123", url: "https://checkout.stripe.test/session" };
});
const createdSessions: Array<Record<string, unknown>> = [];
let stripeConfigured = true;

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/billing/stripe", () => ({
  getStripeClient: () =>
    stripeConfigured ? { checkout: { sessions: { create: checkoutCreate } } } : null,
  getStripeWebhookSecret: () => null,
  getStripePriceId: () => null,
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
  // Real in-memory rate-limit store; partial module mocks of "@/lib/rate-limit"
  // leak into every test file that runs later in the same bun process.
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
  checkoutCreate.mockClear();
  stripeConfigured = true;
});

describe("POST /api/billing/checkout", () => {
  it("creates a stripe checkout session for a fixed SKU", async () => {
    const response = await POST(buildRequest({ sku: "topup_120_notes" }));
    expect(response.status).toBe(200);
    expect(createdSessions).toHaveLength(1);
    expect(createdSessions[0]).toMatchObject({
      metadata: {
        userId: "usr_checkout",
        skuId: "topup_120_notes",
        notesGranted: "130",
        purchaseKind: "sku",
      },
      success_url: "http://test.local/topup/checkout?sku=topup_120_notes&status=success&session_id={CHECKOUT_SESSION_ID}",
    });
  });

  it("creates a stripe checkout session for a custom amount", async () => {
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
      success_url: "http://test.local/topup/checkout?customAmountUsd=12&status=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "http://test.local/topup/checkout?customAmountUsd=12&status=canceled",
    });
  });

  it("rejects malformed topup requests", async () => {
    const response = await POST(buildRequest({ customAmountUsd: 0 }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_topup_request");
    expect(createdSessions).toHaveLength(0);
  });

  it("requires sign-in when stripe is configured", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
      source: "guest",
      sessionId: "sess_guest",
    };
    const response = await POST(buildRequest({ sku: "topup_30_notes" }));
    expect(response.status).toBe(403);
  });

  it("answers 503 when stripe is not configured", async () => {
    stripeConfigured = false;
    const response = await POST(buildRequest({ sku: "topup_30_notes" }));
    expect(response.status).toBe(503);
  });
});
