import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import { setTestNodeEnv } from "@/test-utils/env";

const originalNodeEnv = process.env.NODE_ENV;
const originalDebugSurface = process.env.MURMUR_ENABLE_DEBUG_SURFACE;

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: {
    id: "usr_qa",
    email: "qa@example.com",
    name: "QA",
    avatarUrl: null,
    accountKind: "registered",
  },
  source: "session",
  sessionId: "sess_qa",
};

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

const { GET } = await import("./route");

function request(url = "http://test.local/api/qa/i18n"): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

beforeEach(() => {
  if (originalNodeEnv === "production") {
    setTestNodeEnv("test");
  }
  if (originalDebugSurface === undefined) {
    delete process.env.MURMUR_ENABLE_DEBUG_SURFACE;
  } else {
    process.env.MURMUR_ENABLE_DEBUG_SURFACE = originalDebugSurface;
  }
  nextAuth = {
    ok: true,
    user: {
      id: "usr_qa",
      email: "qa@example.com",
      name: "QA",
      avatarUrl: null,
      accountKind: "registered",
    },
    source: "session",
    sessionId: "sess_qa",
  };
});

afterEach(() => {
  setTestNodeEnv(originalNodeEnv);
  if (originalDebugSurface === undefined) {
    delete process.env.MURMUR_ENABLE_DEBUG_SURFACE;
  } else {
    process.env.MURMUR_ENABLE_DEBUG_SURFACE = originalDebugSurface;
  }
});

describe("GET /api/qa/i18n", () => {
  it("returns the typed i18n audit snapshot", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);

    const body = await response.json() as {
      status: string;
      missingCount: number;
      missing: Array<{ key: string; locations: string[] }>;
      cached: boolean;
    };

    expect(body.status).toBe(body.missingCount > 0 ? "missing" : "ok");
    expect(Array.isArray(body.missing)).toBe(true);
    expect(typeof body.cached).toBe("boolean");
  });

  it("is disabled by default in production", async () => {
    setTestNodeEnv("production");
    delete process.env.MURMUR_ENABLE_DEBUG_SURFACE;

    const response = await GET(request("https://murmur.example/api/qa/i18n"));
    expect(response.status).toBe(403);
    const body = await response.json() as { error?: string };
    expect(body.error).toBe("forbidden");
  });

  it("requires a non-guest session when production debug is explicitly enabled", async () => {
    setTestNodeEnv("production");
    process.env.MURMUR_ENABLE_DEBUG_SURFACE = "true";
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
      source: "guest",
      sessionId: null,
    };

    const response = await GET(request("https://murmur.example/api/qa/i18n"));
    expect(response.status).toBe(403);
    const body = await response.json() as { error?: string };
    expect(body.error).toBe("forbidden");
  });
});
