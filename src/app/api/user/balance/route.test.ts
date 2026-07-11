import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { nextNotesRefillAt, notesRefillWindowKey } from "@/lib/billing/notes-clock";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import { setTestNodeEnv } from "@/test-utils/env";

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
      accountNotes: 3,
      dailyFreeNotes: 2,
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
  grantNotesInTransaction: async () => ({
    ok: true as const,
    ledgerId: "nle_grant_tx",
    balanceBefore: 0,
    balanceAfter: 0,
    duplicate: false,
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

const { GET } = await import("./route");

let originalNodeEnv: string | undefined;
let originalDevBillingFallback: string | undefined;
let originalProductionPreview: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
  originalDevBillingFallback = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
  originalProductionPreview = process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
  delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
});

afterEach(() => {
  setTestNodeEnv(originalNodeEnv);
  if (originalDevBillingFallback === undefined) {
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
  } else {
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = originalDevBillingFallback;
  }
  if (originalProductionPreview === undefined) {
    delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
  } else {
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = originalProductionPreview;
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

  it("keys refill windows by the UTC+8 calendar day", () => {
    expect(notesRefillWindowKey(new Date("2026-06-03T15:30:00.000Z")))
      .toBe("2026-06-03");
    expect(notesRefillWindowKey(new Date("2026-06-03T16:01:00.000Z")))
      .toBe("2026-06-04");
  });
});

describe("GET /api/user/balance", () => {
  it("returns a finite ledger balance for signed-in users", async () => {
    nextAuth = {
      ok: true,
      user: { id: "usr_balance", email: "a@example.com", name: "A", avatarUrl: null },
      source: "session",
      sessionId: "sess_balance",
    };

    const response = await GET(
      new Request("http://test.local/api/user/balance") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      notes?: unknown;
      accountNotes?: unknown;
      dailyFreeNotes?: unknown;
      unlimited?: unknown;
    };
    expect(body.notes).toBe(5);
    expect(body.accountNotes).toBe(3);
    expect(body.dailyFreeNotes).toBe(2);
    expect(body.unlimited).toBe(false);
  });

  it("keeps explicitly enabled production previews usable when the ledger is unavailable", async () => {
    const prevNode = process.env.NODE_ENV;
    setTestNodeEnv("production");
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = "1";
    nextBalanceError = new Error("ECONNREFUSED");

    try {
      const response = await GET(
        new Request("https://preview.example/api/user/balance") as unknown as NextRequest,
      );

      expect(response.status).toBe(200);
      const body = await response.json() as {
        notes?: unknown;
        accountNotes?: unknown;
        dailyFreeNotes?: unknown;
        planTier?: unknown;
      };
      expect(body.notes).toBe(9999);
      expect(body.accountNotes).toBe(9999);
      expect(body.dailyFreeNotes).toBe(0);
      expect(body.planTier).toBe("free");
    } finally {
      setTestNodeEnv(prevNode);
    }
  });

  it("does not expose the dev balance fallback on public production hosts", async () => {
    setTestNodeEnv("production");
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";
    nextBalanceError = new Error("ECONNREFUSED");

    const response = await GET(
      new Request("https://murmur.ptoq.io/api/user/balance") as unknown as NextRequest,
    );

    expect(response.status).toBe(503);
    const body = await response.json() as { error?: unknown; notes?: unknown };
    expect(body.error).toBe("balance_unavailable");
    expect(body.notes).toBeUndefined();
  });
});
