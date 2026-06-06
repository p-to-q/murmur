import { afterEach, describe, expect, it, mock } from "bun:test";
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
}));

const { GET } = await import("./route");

const originalNodeEnv = process.env.NODE_ENV;
const originalDevBillingFallback = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
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
    process.env.NODE_ENV = "production";
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    nextBalanceError = new Error("ECONNREFUSED");

    const response = await GET(
      new Request("http://127.0.0.1:3100/api/user/balance") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { notes?: unknown; planTier?: unknown };
    expect(body.notes).toBe(9999);
    expect(body.planTier).toBe("free");
  });
});
