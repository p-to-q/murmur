import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
  source: "guest",
  sessionId: null,
};

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/platform/music-worker", () => ({
  getMusicEngineMode: () => null,
  getMusicServerlessConfig: () => null,
  getMusicWorkerUrl: () => null,
}));

class TestRunpodError extends Error {
  readonly kind = "server_error";
  readonly detail = null;
}

mock.module("@/lib/platform/runpod-serverless", () => ({
  RunpodError: TestRunpodError,
  endpointHealth: async () => ({
    ok: true,
    status: 200,
    body: null,
  }),
  runJob: async () => {
    throw new Error("runJob should not be called in route tests");
  },
}));

const { POST } = await import("./route");

function buildRequest(requestId: string, headers: HeadersInit = {}): NextRequest {
  return new Request("https://murmur.example/api/music/generate", {
    method: "POST",
    headers: {
      "x-request-id": requestId,
      ...headers,
    },
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
});
