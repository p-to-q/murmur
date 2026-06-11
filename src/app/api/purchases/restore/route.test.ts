import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_restore", email: "restore@test.local", name: "Restore Tester", avatarUrl: null },
  source: "session",
  sessionId: "sess_restore",
};

let stripeConfigured = true;
let stripeSessions: Array<Record<string, unknown>> = [];
const purchaseRows: Array<Record<string, unknown>> = [];
const grantInputs: Array<Record<string, unknown>> = [];

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/rate-limit", () => ({
  getRateLimitStore: () => ({
    hit: async () => ({
      allowed: true,
      retryAfterMs: 0,
      retryAt: new Date("2026-06-12T00:00:00.000Z"),
      limit: 5,
      remaining: 4,
    }),
  }),
}));

mock.module("@/lib/billing/stripe", () => ({
  getStripeClient: () =>
    stripeConfigured
      ? {
          checkout: {
            sessions: {
              list: async function* () {
                for (const session of stripeSessions) {
                  yield session;
                }
              },
            },
          },
        }
      : null,
  getStripeWebhookSecret: () => null,
  getStripePriceId: () => null,
}));

function insertPurchase(values: Record<string, unknown>) {
  const duplicate = purchaseRows.some(
    (row) => row.provider === values.provider && row.providerRef === values.providerRef,
  );
  if (!duplicate) purchaseRows.push({ ...values });
  return {
    onConflictDoNothing: () => ({
      returning: async () => (duplicate ? [] : [{ id: values.id }]),
    }),
  };
}

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () =>
              purchaseRows
                .filter((row) => row.userId === (nextAuth.ok ? nextAuth.user.id : "guest"))
                .map((row) => ({
                  ...row,
                  createdAt: row.createdAt ?? new Date("2026-06-10T12:00:00.000Z"),
                })),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => insertPurchase(values),
    }),
  },
}));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  grantNotes: mock(async (input: Record<string, unknown>) => {
    grantInputs.push(input);
    return {
      ok: true as const,
      ledgerId: "nle_restore",
      balanceBefore: 10,
      balanceAfter: 140,
      duplicate: false,
    };
  }),
}));

const { POST } = await import("./route");

function buildRequest(): NextRequest {
  return new Request("http://test.local/api/purchases/restore", {
    method: "POST",
    headers: {
      "x-request-id": "req_restore",
    },
  }) as unknown as NextRequest;
}

function stripeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_restore_123",
    payment_status: "paid",
    amount_total: 599,
    currency: "usd",
    payment_intent: "pi_restore_123",
    client_reference_id: "usr_restore",
    customer_details: { email: "restore@test.local" },
    metadata: {
      userId: "usr_restore",
      skuId: "topup_120_notes",
      notesGranted: "130",
    },
    ...overrides,
  };
}

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: { id: "usr_restore", email: "restore@test.local", name: "Restore Tester", avatarUrl: null },
    source: "session",
    sessionId: "sess_restore",
  };
  stripeConfigured = true;
  stripeSessions = [];
  purchaseRows.length = 0;
  grantInputs.length = 0;
});

describe("POST /api/purchases/restore", () => {
  it("requires sign-in", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
      source: "guest",
      sessionId: null,
    };
    const response = await POST(buildRequest());
    expect(response.status).toBe(403);
  });

  it("returns existing local purchases when stripe is unavailable", async () => {
    stripeConfigured = false;
    purchaseRows.push({
      id: "pur_existing",
      userId: "usr_restore",
      provider: "stripe",
      productId: "topup_30_notes",
      providerRef: "cs_existing",
      amountCents: 199,
      currency: "USD",
      notesGranted: 30,
      status: "succeeded",
      createdAt: new Date("2026-06-10T12:00:00.000Z"),
    });

    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { newPurchases: number; restored: Array<{ id: string }> };
    expect(body.newPurchases).toBe(0);
    expect(body.restored).toHaveLength(1);
    expect(body.restored[0]?.id).toBe("pur_existing");
  });

  it("restores a missing stripe purchase into local records and ledger", async () => {
    stripeSessions = [stripeSession()];

    const response = await POST(buildRequest());
    expect(response.status).toBe(200);

    const body = (await response.json()) as { newPurchases: number; restored: Array<{ productId: string }> };
    expect(body.newPurchases).toBe(1);
    expect(body.restored.some((purchase) => purchase.productId === "topup_120_notes")).toBe(true);
    expect(purchaseRows).toHaveLength(1);
    expect(grantInputs).toHaveLength(1);
    expect(grantInputs[0]).toMatchObject({
      userId: "usr_restore",
      amount: 130,
      reason: "purchase:topup",
      externalRef: "cs_restore_123",
      metadata: {
        provider: "stripe",
        skuId: "topup_120_notes",
        checkoutSessionId: "cs_restore_123",
        restoredBy: "restore_route",
      },
    });
  });

  it("restores custom topups with the same server-side pricing contract", async () => {
    stripeSessions = [
      stripeSession({
        id: "cs_restore_custom",
        amount_total: 1200,
        payment_intent: "pi_restore_custom",
        metadata: {
          userId: "usr_restore",
          skuId: "topup_custom",
          notesGranted: "240",
          customAmountUsd: "12",
        },
      }),
    ];

    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { newPurchases: number };
    expect(body.newPurchases).toBe(1);
    expect(grantInputs[0]).toMatchObject({
      amount: 240,
      metadata: {
        skuId: "topup_custom",
        customAmountUsd: 12,
      },
    });
  });
});
