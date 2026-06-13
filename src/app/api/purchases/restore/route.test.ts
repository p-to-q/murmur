import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_restore", email: "restore@test.local", name: "Restore Tester", avatarUrl: null },
  source: "session",
  sessionId: "sess_restore",
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
                .filter((row) => row.userId === (nextAuth.ok ? nextAuth.user.id : "guest"))
                .map((row) => ({
                  ...row,
                  createdAt: row.createdAt ?? new Date("2026-06-10T12:00:00.000Z"),
                })),
          }),
        }),
      }),
    }),
  },
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

beforeEach(async () => {
  resetCachedRateLimitStore();
  await getRateLimitStore().resetAll();
  nextAuth = {
    ok: true,
    user: { id: "usr_restore", email: "restore@test.local", name: "Restore Tester", avatarUrl: null },
    source: "session",
    sessionId: "sess_restore",
  };
  purchaseRows.length = 0;
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

  it("returns existing local Waffo purchases", async () => {
    purchaseRows.push({
      id: "pur_existing",
      userId: "usr_restore",
      provider: "waffo",
      productId: "topup_30_notes",
      providerRef: "ORD_existing",
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
});
