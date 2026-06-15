import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { nextNotesRefillAt } from "@/lib/billing/notes-clock";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "guest", email: null, name: "Local Creator", avatarUrl: null },
  source: "guest",
  sessionId: null,
};
let nextBalanceError: unknown = null;

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  getNotesBalance: async () => {
    if (nextBalanceError) throw nextBalanceError;
    return {
      ok: true as const,
      userId: "guest",
      notes: 5,
      planTier: "free" as const,
      freeNotesGrantedAt: new Date("2026-06-05T00:00:00.000Z"),
    };
  },
  // Unused here, but every mock of this module must declare the full export
  // surface — bun can't add new export names to an already-created record.
  spendNotes: async () => ({ ok: false as const, reason: "user_not_found" as const, currentBalance: 0 }),
  refundNotes: async () => ({ ok: false as const, reason: "original_not_found" as const }),
  reverseTopupGrant: async () => ({ ok: false as const, reason: "purchase_grant_not_found" as const }),
  grantNotes: async () => ({
    ok: true as const,
    ledgerId: "nle_grant",
    balanceBefore: 0,
    balanceAfter: 0,
    duplicate: false,
  }),
  decideGrant: () => ({ kind: "grant", balanceAfter: 0 }),
  decideSpend: () => ({ kind: "insufficient", currentBalance: 0 }),
  decideRefund: () => ({ kind: "original_missing" }),
  refundReferenceFor: (id: string) => `refund:${id}`,
}));

const { GET } = await import("./route");

let originalNodeEnv: string | undefined;
let originalDevBillingFallback: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
  originalDevBillingFallback = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
});

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalDevBillingFallback === undefined) {
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
  } else {
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = originalDevBillingFallback;
  }
  nextAuth = {
    ok: true,
    user: { id: "guest", email: null, name: "Local Creator", avatarUrl: null },
    source: "guest",
    sessionId: null,
  };
  nextBalanceError = null;
});

describe("user balance route helpers", () => {
  it("returns the next midnight at UTC+8", () => {
    expect(nextNotesRefillAt(new Date("2026-06-03T15:30:00.000Z")).toISOString())
      .toBe("2026-06-03T16:00:00.000Z");
    expect(nextNotesRefillAt(new Date("2026-06-03T16:01:00.000Z")).toISOString())
      .toBe("2026-06-04T16:00:00.000Z");
  });
});

describe("GET /api/user/balance", () => {
  it("keeps localhost previews usable when the ledger is unavailable outside dev mode", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "production";
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    nextBalanceError = new Error("ECONNREFUSED");

    try {
      const response = await GET(
        new Request("http://127.0.0.1:3100/api/user/balance") as unknown as NextRequest,
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { notes?: unknown; planTier?: unknown };
      expect(body.notes).toBe(9999);
      expect(body.planTier).toBe("free");
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevFlag === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
    }
  });
});
