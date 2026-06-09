import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

/* ── Stripe mock ────────────────────────────────────────────────────── */

let stripeConfigured = true;
let nextEvent: Record<string, unknown> | null = null;
let signatureError: Error | null = null;

const constructEventAsync = mock(async () => {
  if (signatureError) throw signatureError;
  return nextEvent;
});

mock.module("@/lib/billing/stripe", () => ({
  getStripeClient: () =>
    stripeConfigured ? { webhooks: { constructEventAsync } } : null,
  getStripeWebhookSecret: () => (stripeConfigured ? "whsec_test" : null),
  getStripePriceId: () => null,
}));

/* ── DB mock ────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;
const eventInserts: Row[] = [];
const purchaseInserts: Row[] = [];
const eventUpdates: Row[] = [];
let eventInsertConflicts = false;

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

mock.module("@/lib/db/client", () => ({
  db: {
    insert: () => ({ values: (v: Row) => insertChain(v) }),
    update: () => ({
      set: (v: Row) => ({
        where: () => {
          eventUpdates.push(v);
          return Promise.resolve([]);
        },
      }),
    }),
  },
}));

/* ── Ledger mock ────────────────────────────────────────────────────── */

const grantInputs: Row[] = [];
let grantResult: Row = {
  ok: true,
  ledgerId: "nle_test",
  balanceBefore: 5,
  balanceAfter: 135,
  duplicate: false,
};

mock.module("@/lib/db/queries/notes-ledger", () => ({
  grantNotes: mock(async (input: Row) => {
    grantInputs.push(input);
    return grantResult;
  }),
  // Unused here, but every mock of this module must declare the full export
  // surface — bun can't add new export names to an already-created record.
  getNotesBalance: async () => ({
    ok: true as const,
    userId: "guest",
    notes: 0,
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
}));

const { POST } = await import("./route");

/* ── Helpers ────────────────────────────────────────────────────────── */

function buildRequest(withSignature = true): NextRequest {
  return new Request("http://test.local/api/billing/webhook", {
    method: "POST",
    headers: withSignature ? { "stripe-signature": "t=1,v1=sig" } : {},
    body: "{}",
  }) as unknown as NextRequest;
}

function paidSessionEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_123",
        payment_status: "paid",
        amount_total: 599,
        currency: "usd",
        payment_intent: "pi_123",
        client_reference_id: "usr_buyer",
        metadata: {
          userId: "usr_buyer",
          skuId: "topup_120_notes",
          notesGranted: "130",
        },
        ...overrides,
      },
    },
  };
}

beforeEach(() => {
  stripeConfigured = true;
  nextEvent = paidSessionEvent();
  signatureError = null;
  eventInsertConflicts = false;
  eventInserts.length = 0;
  purchaseInserts.length = 0;
  eventUpdates.length = 0;
  grantInputs.length = 0;
  grantResult = {
    ok: true,
    ledgerId: "nle_test",
    balanceBefore: 5,
    balanceAfter: 135,
    duplicate: false,
  };
});

/* ── Tests ──────────────────────────────────────────────────────────── */

describe("POST /api/billing/webhook", () => {
  it("answers 503 when Stripe is not configured", async () => {
    stripeConfigured = false;
    const response = await POST(buildRequest());
    expect(response.status).toBe(503);
  });

  it("rejects requests without a stripe-signature header", async () => {
    const response = await POST(buildRequest(false));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("missing_signature");
  });

  it("rejects requests with an invalid signature", async () => {
    signatureError = new Error("bad signature");
    const response = await POST(buildRequest());
    expect(response.status).toBe(400);
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

  it("records the purchase and grants notes for a paid session", async () => {
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { granted?: number };
    expect(body.granted).toBe(130);

    expect(purchaseInserts).toHaveLength(1);
    expect(purchaseInserts[0]).toMatchObject({
      userId: "usr_buyer",
      provider: "stripe",
      productId: "topup_120_notes",
      providerRef: "cs_test_123",
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
      externalRef: "cs_test_123",
    });

    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("ignores unpaid sessions without granting", async () => {
    nextEvent = paidSessionEvent({ payment_status: "unpaid" });
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    expect(grantInputs).toHaveLength(0);
    expect(purchaseInserts).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("marks malformed sessions failed but acknowledges them", async () => {
    nextEvent = paidSessionEvent({
      client_reference_id: null,
      metadata: {},
    });
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("non_retryable");
    expect(grantInputs).toHaveLength(0);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("returns 500 (retryable) when the grant fails", async () => {
    grantResult = { ok: false, reason: "user_not_found" };
    const response = await POST(buildRequest());
    expect(response.status).toBe(500);
    expect(eventUpdates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("ignores unrelated event types", async () => {
    nextEvent = { id: "evt_2", type: "invoice.paid", data: { object: {} } };
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ignored?: string };
    expect(body.ignored).toBe("invoice.paid");
    expect(grantInputs).toHaveLength(0);
  });
});
