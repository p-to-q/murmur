import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_payments", email: "payments@test.local", name: "Payment Tester", avatarUrl: null },
  source: "session",
  sessionId: "sess_payments",
};

const purchaseRows: Array<Record<string, unknown>> = [];

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () =>
              purchaseRows
                .filter(
                  (row) =>
                    row.userId === (nextAuth.ok ? nextAuth.user.id : "guest")
                    && row.provider === "waffo",
                )
                .map((row) => ({
                  ...row,
                  createdAt: row.createdAt ?? new Date("2026-06-10T12:00:00.000Z"),
                  updatedAt: row.updatedAt ?? new Date("2026-06-10T12:00:00.000Z"),
                })),
          }),
        }),
      }),
    }),
  },
}));

const { GET } = await import("./route");

function buildRequest(): NextRequest {
  return new Request("http://test.local/api/user/payments", {
    method: "GET",
    headers: {
      "x-request-id": "req_payments",
    },
  }) as unknown as NextRequest;
}

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: { id: "usr_payments", email: "payments@test.local", name: "Payment Tester", avatarUrl: null },
    source: "session",
    sessionId: "sess_payments",
  };
  purchaseRows.length = 0;
});

describe("GET /api/user/payments", () => {
  it("requires sign-in", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
      source: "guest",
      sessionId: null,
    };

    const response = await GET(buildRequest());
    expect(response.status).toBe(403);
  });

  it("returns only the signed-in user's Waffo payment summaries", async () => {
    purchaseRows.push(
      {
        id: "pur_own",
        userId: "usr_payments",
        provider: "waffo",
        productId: "topup_120_notes",
        providerRef: "ORD_own",
        amountCents: 599,
        currency: "USD",
        notesGranted: 130,
        status: "succeeded",
      },
      {
        id: "pur_other",
        userId: "usr_other",
        provider: "waffo",
        productId: "topup_30_notes",
        providerRef: "ORD_other",
        amountCents: 199,
        currency: "USD",
        notesGranted: 30,
        status: "succeeded",
      },
      {
        id: "pur_legacy",
        userId: "usr_payments",
        provider: "stripe",
        productId: "topup_30_notes",
        providerRef: "pi_legacy",
        amountCents: 199,
        currency: "USD",
        notesGranted: 30,
        status: "succeeded",
      },
    );

    const response = await GET(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { payments: Array<{ id: string; providerRef: string; createdAt: string }> };
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({
      id: "pur_own",
      providerRef: "ORD_own",
    });
    expect(body.payments[0]?.createdAt).toBe("2026-06-10T12:00:00.000Z");
  });
});
