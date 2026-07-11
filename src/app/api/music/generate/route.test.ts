import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

import type {
  BalanceResult,
  RefundNotesInput,
  RefundNotesResult,
  SpendNotesInput,
  SpendNotesResult,
} from "@/lib/db/queries/notes-ledger";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
  source: "guest",
  sessionId: null,
};
let nextBalance: BalanceResult = {
  ok: true,
  userId: "guest",
  notes: 10,
  accountNotes: 5,
  dailyFreeNotes: 5,
  planTier: "free",
  freeNotesGrantedAt: new Date(),
};
let nextSpendResult: SpendNotesResult = {
  ok: true,
  ledgerId: "nle_music_generate",
  balanceBefore: 10,
  balanceAfter: 9,
  duplicate: false,
};
let nextEngineMode: "serverless" | "http" | null = null;
let nextRunJobThrows: Error | null = null;
let nextRefundResult: RefundNotesResult | null = null;
let nextRefundThrows: Error | null = null;
type QueueDepthShape = {
  inQueue: number;
  inProgress: number;
  workers: { idle: number; running: number; total: number };
};
let nextQueueDepth: QueueDepthShape | null = null;
const lastSpendInputs: SpendNotesInput[] = [];
const lastRefundInputs: RefundNotesInput[] = [];
const lastPendingRefundInputs: Array<{ userId: string; originalLedgerId: string }> = [];
let runJobCallCount = 0;

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  getNotesBalance: async () => nextBalance,
  spendNotes: async (input: SpendNotesInput) => {
    lastSpendInputs.push(input);
    return nextSpendResult;
  },
  refundNotes: async (input: RefundNotesInput) => {
    lastRefundInputs.push(input);
    if (nextRefundThrows) throw nextRefundThrows;
    if (nextRefundResult) return nextRefundResult;
    return {
      ok: true as const,
      refundLedgerId: "nle_music_refund",
      originalLedgerId: input.originalLedgerId,
      balanceBefore: 9,
      balanceAfter: 10,
      amount: 1,
      duplicate: false,
    };
  },
  recordPendingRefund: async (input: { userId: string; originalLedgerId: string }) => {
    lastPendingRefundInputs.push(input);
    return {
      ok: true as const,
      pendingLedgerId: "nle_pending",
      externalRef: `refund_pending:${input.originalLedgerId}`,
      duplicate: false,
    };
  },
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

mock.module("@/lib/platform/music-worker", () => ({
  getMusicEngineMode: () => nextEngineMode,
  getMusicServerlessConfig: () =>
    nextEngineMode === "serverless"
      ? { endpointId: "endpoint_test", apiKey: "runpod_key_test" }
      : null,
  getMusicWorkerUrl: () => null,
  getRequestedMusicEngineMode: () =>
    nextEngineMode === "http" ? "http" : "auto",
}));

class TestRunpodError extends Error {
  readonly detail = null;
  constructor(readonly kind: string = "server_error") {
    super(`runpod ${kind}`);
  }
}

interface PublishedNotification {
  title: string;
  body: string;
  userId: string;
  data?: Record<string, unknown>;
}

const publishedNotifications: PublishedNotification[] = [];

mock.module("@/lib/platform/notifications-server", () => ({
  notifications: {
    publish: async (input: PublishedNotification) => {
      publishedNotifications.push(input);
      return {
        delivered: 1,
        failed: 0,
        removed: 0,
        publishId: "push-test",
        title: input.title,
      };
    },
  },
}));

// Publish is scheduled via scheduleAfterResponse, which falls back to a
// microtask outside a Next request scope — flush it before asserting.
async function flushScheduledPublishes(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

mock.module("@/lib/platform/runpod-serverless", () => ({
  RunpodError: TestRunpodError,
  endpointHealth: async () => ({
    ok: true,
    status: 200,
    body: { workers: { idle: 0, running: 0 } },
  }),
  getQueueDepth: async () => nextQueueDepth,
  runJob: async () => {
    runJobCallCount += 1;
    if (nextRunJobThrows) throw nextRunJobThrows;
    return {
      audio_b64: Buffer.from(new Uint8Array([82, 73, 70, 70])).toString("base64"),
      model: "test-model",
      generation_ms: 123,
      style_mix: "0.35",
    };
  },
}));

const { POST } = await import("./route");

function buildRequest(requestId: string, headers: HeadersInit = {}): NextRequest {
  const form = new FormData();
  form.append("prompt", "warm cassette piano");
  form.append("duration", "10");
  return new Request("https://murmur.example/api/music/generate", {
    method: "POST",
    headers: {
      "x-request-id": requestId,
      ...headers,
    },
    body: form,
  }) as unknown as NextRequest;
}

beforeEach(async () => {
  resetCachedRateLimitStore();
  await getRateLimitStore().resetAll();
  nextAuth = {
    ok: true,
    user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
    source: "guest",
    sessionId: null,
  };
  nextBalance = {
    ok: true,
    userId: "guest",
    notes: 10,
    accountNotes: 5,
    dailyFreeNotes: 5,
    planTier: "free",
    freeNotesGrantedAt: new Date(),
  };
  nextSpendResult = {
    ok: true,
    ledgerId: "nle_music_generate",
    balanceBefore: 10,
    balanceAfter: 9,
    duplicate: false,
  };
  nextEngineMode = null;
  nextRunJobThrows = null;
  nextRefundResult = null;
  nextRefundThrows = null;
  nextQueueDepth = null;
  lastSpendInputs.length = 0;
  lastRefundInputs.length = 0;
  lastPendingRefundInputs.length = 0;
  runJobCallCount = 0;
  publishedNotifications.length = 0;
});

describe("POST /api/music/generate", () => {
  it("rate limits guest GPU generation by IP before worker handoff", async () => {
    const headers = { "x-real-ip": "203.0.113.24" };

    for (let i = 0; i < 6; i += 1) {
      const response = await POST(buildRequest(`req_allowed_${i}`, headers));
      expect(response.status).toBe(503);
      const body = await response.json() as { error: string };
      expect(body.error).toBe("worker_unconfigured");
    }

    const blocked = await POST(buildRequest("req_blocked", headers));
    expect(blocked.status).toBe(429);
    const body = await blocked.json() as { error: string; requestId: string };
    expect(body.error).toBe("rate_limited");
    expect(body.requestId).toBe("req_blocked");
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe("6");
  });

  it("keeps registered users in separate GPU generation buckets", async () => {
    const headers = { "x-real-ip": "203.0.113.24" };
    nextAuth = {
      ok: true,
      user: { id: "usr_one", email: null, name: "One", avatarUrl: null },
      source: "session",
      sessionId: "sess_one",
    };

    for (let i = 0; i < 6; i += 1) {
      await POST(buildRequest(`req_one_${i}`, headers));
    }

    nextAuth = {
      ok: true,
      user: { id: "usr_two", email: null, name: "Two", avatarUrl: null },
      source: "session",
      sessionId: "sess_two",
    };
    const response = await POST(buildRequest("req_two", headers));

    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("worker_unconfigured");
  });

  it("returns 429 when the daily GPU generation bucket is exhausted", async () => {
    const headers = { "x-real-ip": "203.0.113.48" };
    const store = getRateLimitStore();

    await store.hit(
      "/api/music/generate:user:daily:guest:203.0.113.48",
      { capacity: 48, refillWindowMs: 24 * 60 * 60 * 1000, cost: 48 },
    );

    const response = await POST(buildRequest("req_daily_blocked", headers));

    expect(response.status).toBe(429);
    const body = await response.json() as { error: string; requestId: string };
    expect(body.error).toBe("rate_limited");
    expect(body.requestId).toBe("req_daily_blocked");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("48");
  });

  it("refunds the note and reports client_closed_request when the browser disconnects mid-generation", async () => {
    nextEngineMode = "serverless";
    nextAuth = {
      ok: true,
      user: { id: "usr_aborted", email: null, name: "Aborted", avatarUrl: null },
      source: "session",
      sessionId: "sess_aborted",
    };
    nextRunJobThrows = new TestRunpodError("aborted");

    const response = await POST(buildRequest("req_music_aborted"));

    expect(response.status).toBe(499);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("client_closed_request");
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastRefundInputs).toHaveLength(1);
    expect(lastRefundInputs[0]).toMatchObject({ originalLedgerId: "nle_music_generate" });
  });

  it("spends one note before handing work to RunPod", async () => {
    nextEngineMode = "serverless";
    nextAuth = {
      ok: true,
      user: { id: "usr_music", email: null, name: "Music", avatarUrl: null },
      source: "session",
      sessionId: "sess_music",
    };

    const response = await POST(buildRequest("req_music_spend"));

    expect(response.status).toBe(200);
    expect(runJobCallCount).toBe(1);
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastSpendInputs[0]).toMatchObject({
      userId: "usr_music",
      reason: "spend:music_generate",
      cost: 1,
    });
    expect(lastSpendInputs[0]?.externalRef).toStartWith("music_generate:");
    expect(lastSpendInputs[0]?.externalRef).not.toBe("req_music_spend");
    expect(lastSpendInputs[0]?.metadata?.requestId).toBe("req_music_spend");
    expect(lastRefundInputs).toHaveLength(0);
  });

  it("returns 402 before RunPod when notes are insufficient", async () => {
    nextEngineMode = "serverless";
    nextBalance = {
      ok: true,
      userId: "usr_empty",
      notes: 0,
      accountNotes: 0,
      dailyFreeNotes: 0,
      planTier: "free",
      freeNotesGrantedAt: new Date(),
    };
    nextAuth = {
      ok: true,
      user: { id: "usr_empty", email: null, name: "Empty", avatarUrl: null },
      source: "session",
      sessionId: "sess_empty",
    };

    const response = await POST(buildRequest("req_music_empty"));

    expect(response.status).toBe(402);
    expect(runJobCallCount).toBe(0);
    expect(lastSpendInputs).toHaveLength(0);
    const body = await response.json() as { error: string; currentBalance: number; cost: number };
    expect(body.error).toBe("insufficient_notes");
    expect(body.currentBalance).toBe(0);
    expect(body.cost).toBe(1);
  });

  it("refunds the note when RunPod generation fails", async () => {
    nextEngineMode = "serverless";
    nextRunJobThrows = new Error("runpod unavailable");
    nextAuth = {
      ok: true,
      user: { id: "usr_fail", email: null, name: "Fail", avatarUrl: null },
      source: "session",
      sessionId: "sess_fail",
    };

    const response = await POST(buildRequest("req_music_fail"));

    expect(response.status).toBe(502);
    expect(runJobCallCount).toBe(1);
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastRefundInputs).toHaveLength(1);
    expect(lastRefundInputs[0]?.originalLedgerId).toBe("nle_music_generate");
    expect(lastRefundInputs[0]?.metadata?.trigger).toBe("worker_http_error");
  });

  it("records a pending-refund marker and returns refund_pending when the refund fails (#232)", async () => {
    nextEngineMode = "serverless";
    nextRunJobThrows = new Error("runpod unavailable");
    nextRefundResult = { ok: false, reason: "original_not_found" };
    nextAuth = {
      ok: true,
      user: { id: "usr_refund_fail", email: null, name: "Refund Fail", avatarUrl: null },
      source: "session",
      sessionId: "sess_refund_fail",
    };

    const response = await POST(buildRequest("req_music_refund_fail"));

    expect(response.status).toBe(500);
    expect(runJobCallCount).toBe(1);
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastRefundInputs).toHaveLength(1);
    // The lost note is durably recorded for reconcile to retry, keyed by the spend.
    expect(lastPendingRefundInputs).toHaveLength(1);
    expect(lastPendingRefundInputs[0]?.originalLedgerId).toBe("nle_music_generate");
    const body = await response.json() as { error: string };
    expect(body.error).toBe("refund_pending");
  });

  it("sheds load before spending a note for any account kind when the queue is deep (#230)", async () => {
    nextEngineMode = "serverless";
    nextQueueDepth = {
      inQueue: 10,
      inProgress: 2,
      workers: { idle: 0, running: 2, total: 2 },
    };
    nextAuth = {
      ok: true,
      user: { id: "usr_shed", email: null, name: "Shed", avatarUrl: null },
      source: "session",
      sessionId: "sess_shed",
    };

    const response = await POST(buildRequest("req_music_shed"));

    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("worker_overloaded");
    // The whole point of #230: never charge a note we can't deliver on a cold pool.
    expect(lastSpendInputs).toHaveLength(0);
    expect(runJobCallCount).toBe(0);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("collapses sibling clips of one batch under a shared push identity", async () => {
    nextEngineMode = "serverless";
    nextAuth = {
      ok: true,
      user: { id: "usr_batch", email: null, name: "Batch", avatarUrl: null },
      source: "session",
      sessionId: "sess_batch",
    };
    const batchHeaders = { "x-generation-batch-id": "batch_abc-123" };

    const first = await POST(buildRequest("req_batch_clip_1", batchHeaders));
    const second = await POST(buildRequest("req_batch_clip_2", batchHeaders));
    await flushScheduledPublishes();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(publishedNotifications).toHaveLength(2);
    for (const published of publishedNotifications) {
      expect(published.userId).toBe("usr_batch");
      expect(published.data).toMatchObject({
        kind: "song_generated",
        tag: "murmur-generation-batch_abc-123",
        sourceId: "batch_abc-123",
        notificationId: "song_generated:batch_abc-123",
        batchId: "batch_abc-123",
      });
    }
    expect(publishedNotifications.map((p) => p.data?.requestId)).toEqual([
      "req_batch_clip_1",
      "req_batch_clip_2",
    ]);
  });

  it("falls back to per-request push identity without a valid batch header", async () => {
    nextEngineMode = "serverless";
    nextAuth = {
      ok: true,
      user: { id: "usr_nobatch", email: null, name: "NoBatch", avatarUrl: null },
      source: "session",
      sessionId: "sess_nobatch",
    };

    const missing = await POST(buildRequest("req_no_batch"));
    const malformed = await POST(
      buildRequest("req_bad_batch", { "x-generation-batch-id": "bad batch!!" }),
    );
    await flushScheduledPublishes();

    expect(missing.status).toBe(200);
    expect(malformed.status).toBe(200);
    expect(publishedNotifications).toHaveLength(2);
    expect(publishedNotifications[0]?.data).toMatchObject({
      tag: "murmur-generation-req_no_batch",
      sourceId: "req_no_batch",
      notificationId: "song_generated:req_no_batch",
      batchId: null,
    });
    expect(publishedNotifications[1]?.data).toMatchObject({
      tag: "murmur-generation-req_bad_batch",
      batchId: null,
    });
  });

  it("does not use dev billing fallback for Local Creator sessions", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    nextEngineMode = "serverless";
    nextAuth = {
      ok: true,
      user: {
        id: "lc_music",
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: "sess_lc_music",
    };

    try {
      const response = await POST(buildRequest("req_local_creator_music"));
      expect(response.status).toBe(200);
      expect(lastSpendInputs).toHaveLength(1);
      expect(lastSpendInputs[0]?.userId).toBe("lc_music");
      expect(runJobCallCount).toBe(1);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
