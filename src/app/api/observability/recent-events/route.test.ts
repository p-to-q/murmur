import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_debug", email: null, name: "Debug User", avatarUrl: null },
  source: "session",
  sessionId: "sess_debug",
};

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/observability/recent-events", () => ({
  getRecentEvents: () => [
    {
      event: "transcribe.completed",
      level: "info",
      ts: "2026-06-05T00:00:00.000Z",
      route: "/api/transcribe",
      requestId: "req_debug",
      userId: "usr_debug",
      shell: "web",
      durationMs: 120,
      ext: { provider: "swiftf0" },
    },
  ],
}));

const { GET } = await import("./route");

function buildRequest(url = "http://test.local/api/observability/recent-events"): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: { id: "usr_debug", email: null, name: "Debug User", avatarUrl: null },
    source: "session",
    sessionId: "sess_debug",
  };
});

describe("GET /api/observability/recent-events", () => {
  it("requires a signed-in session even when debug surface is enabled", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
      source: "guest",
      sessionId: null,
    };

    const response = await GET(buildRequest());
    expect(response.status).toBe(403);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("allows guest debug access on localhost in non-production previews", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
      source: "guest",
      sessionId: null,
    };

    const response = await GET(buildRequest("http://localhost/api/observability/recent-events"));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      events: Array<{ event: string; requestId: string }>;
    };
    expect(body.events[0]?.requestId).toBe("req_debug");
  });

  it("returns the recent event buffer for authenticated sessions", async () => {
    const response = await GET(buildRequest());
    expect(response.status).toBe(200);
    const body = await response.json() as {
      events: Array<{ event: string; requestId: string }>;
    };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.event).toBe("transcribe.completed");
    expect(body.events[0]?.requestId).toBe("req_debug");
  });
});
