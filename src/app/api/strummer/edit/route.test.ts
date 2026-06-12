import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type {
  BalanceResult,
  RefundNotesInput,
  SpendNotesInput,
  SpendNotesResult,
} from "@/lib/db/queries/notes-ledger";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_strummer", email: null, name: "Strummer", avatarUrl: null },
  source: "session",
  sessionId: "sess_strummer",
};
let nextBalance: BalanceResult = {
  ok: true,
  userId: "usr_strummer",
  notes: 10,
  planTier: "free",
  freeNotesGrantedAt: new Date(),
};
let nextSpendResult: SpendNotesResult = {
  ok: true,
  ledgerId: "nle_llm",
  balanceBefore: 10,
  balanceAfter: 9,
  duplicate: false,
};
let nextAiThrows: Error | null = null;
let chatCallCount = 0;
const lastSpendInputs: SpendNotesInput[] = [];
const lastRefundInputs: RefundNotesInput[] = [];
const callOrder: string[] = [];
let previousOpenAiKey: string | undefined;
let previousRateLimitDriver: string | undefined;

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  getNotesBalance: async () => nextBalance,
  spendNotes: async (input: SpendNotesInput) => {
    callOrder.push("spend");
    lastSpendInputs.push(input);
    return nextSpendResult;
  },
  refundNotes: async (input: RefundNotesInput) => {
    callOrder.push("refund");
    lastRefundInputs.push(input);
    return {
      ok: true as const,
      refundLedgerId: "nle_refund",
      originalLedgerId: input.originalLedgerId,
      balanceBefore: 9,
      balanceAfter: 10,
      amount: 1,
      duplicate: false,
    };
  },
  // Unused here, but every mock of this module must declare the full export
  // surface — bun can't add new export names to an already-created record.
  grantNotes: async () => ({
    ok: true as const,
    ledgerId: "nle_grant",
    balanceBefore: 0,
    balanceAfter: 0,
    duplicate: false,
  }),
}));

mock.module("@/lib/platform/ai-server", () => ({
  ai: {
    chat: async () => {
      callOrder.push("ai");
      chatCallCount += 1;
      if (nextAiThrows) throw nextAiThrows;
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                tokens: ["warmer", "less_drums"],
                reason: "test",
              }),
            },
          },
        ],
      };
    },
  },
}));

const { POST } = await import("./route");

function buildRequest(prompt = "make it warmer", requestId = "req_strummer"): NextRequest {
  return new Request("http://test.local/api/strummer/edit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
    body: JSON.stringify({ prompt }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  previousOpenAiKey = process.env.OPENAI_API_KEY;
  previousRateLimitDriver = process.env.MURMUR_RATE_LIMIT_DRIVER;
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.MURMUR_RATE_LIMIT_DRIVER;
  resetCachedRateLimitStore();
  getRateLimitStore().resetAll();
  nextAuth = {
    ok: true,
    user: { id: "usr_strummer", email: null, name: "Strummer", avatarUrl: null },
    source: "session",
    sessionId: "sess_strummer",
  };
  nextBalance = {
    ok: true,
    userId: "usr_strummer",
    notes: 10,
    planTier: "free",
    freeNotesGrantedAt: new Date(),
  };
  nextSpendResult = {
    ok: true,
    ledgerId: "nle_llm",
    balanceBefore: 10,
    balanceAfter: 9,
    duplicate: false,
  };
  nextAiThrows = null;
  chatCallCount = 0;
  lastSpendInputs.length = 0;
  lastRefundInputs.length = 0;
  callOrder.length = 0;
});

afterEach(() => {
  if (previousOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
  if (previousRateLimitDriver === undefined) {
    delete process.env.MURMUR_RATE_LIMIT_DRIVER;
  } else {
    process.env.MURMUR_RATE_LIMIT_DRIVER = previousRateLimitDriver;
  }
  resetCachedRateLimitStore();
});

describe("POST /api/strummer/edit", () => {
  it("returns filtered tokens without spending for signed-in users", async () => {
    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(["ai"]);
    expect(lastSpendInputs).toHaveLength(0);
    const body = await response.json() as { tokens: string[] };
    expect(body.tokens).toEqual(["warmer", "less_drums"]);
  });

  it("does not refund when the model fails for signed-in users", async () => {
    nextAiThrows = new Error("provider offline");

    const response = await POST(buildRequest("make it cinematic", "req_llm_fail"));

    expect(response.status).toBe(502);
    expect(callOrder).toEqual(["ai"]);
    expect(lastRefundInputs).toHaveLength(0);
  });

  it("skips billing entirely for signed-in users on model failure", async () => {
    nextAiThrows = new Error("provider offline");

    const response = await POST(buildRequest());

    expect(response.status).toBe(502);
    expect(callOrder).toEqual(["ai"]);
    expect(lastRefundInputs).toHaveLength(0);
  });

  it("returns 429 before billing or model work when rate-limited", async () => {
    const store = getRateLimitStore();
    for (let i = 0; i < 10; i += 1) {
      await store.hit("/api/strummer/edit:user:usr_strummer", {
        capacity: 10,
        refillWindowMs: 60_000,
      });
    }

    const response = await POST(buildRequest("more strings", "req_rate_limited"));

    expect(response.status).toBe(429);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(chatCallCount).toBe(0);
    expect(lastSpendInputs).toHaveLength(0);
    const body = await response.json() as { error: string; requestId: string };
    expect(body.error).toBe("rate_limited");
    expect(body.requestId).toBe("req_rate_limited");
  });
});
