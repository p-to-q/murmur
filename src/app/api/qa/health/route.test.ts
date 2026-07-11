import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import { createFetchMock } from "@/test-utils/fetch";
import { setTestNodeEnv } from "@/test-utils/env";

const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalDebugSurface = process.env.MURMUR_ENABLE_DEBUG_SURFACE;
const originalWorkerUrl = process.env.AUDIO_WORKER_URL;

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

function request(url = "http://test.local/api/qa/health"): NextRequest {
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
  process.env.AUDIO_WORKER_URL = "http://worker.test";
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
  globalThis.fetch = originalFetch;
  setTestNodeEnv(originalNodeEnv);
  if (originalDebugSurface === undefined) {
    delete process.env.MURMUR_ENABLE_DEBUG_SURFACE;
  } else {
    process.env.MURMUR_ENABLE_DEBUG_SURFACE = originalDebugSurface;
  }
  if (originalWorkerUrl === undefined) {
    delete process.env.AUDIO_WORKER_URL;
  } else {
    process.env.AUDIO_WORKER_URL = originalWorkerUrl;
  }
});

describe("GET /api/qa/health", () => {
  it("returns an ok health snapshot when the worker responds healthy", async () => {
    globalThis.fetch = createFetchMock(async () =>
      Response.json({
        status: "ok",
        service: "murmur-audio-engine",
      }));

    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      worker: { configured: boolean; ok: boolean; status: string; service: string | null };
      qaRoutes: string[];
    };

    expect(body.status).toBe("ok");
    expect(body.worker.configured).toBe(true);
    expect(body.worker.ok).toBe(true);
    expect(body.worker.status).toBe("ok");
    expect(body.worker.service).toBe("murmur-audio-engine");
    expect(body.qaRoutes).toContain("/studio?demo=1");
    expect(body.qaRoutes).toContain("/me/debug?debug=1");
    expect(body.qaRoutes).toContain("/me/settings");
  });

  it("returns degraded when the worker is unconfigured", async () => {
    delete process.env.AUDIO_WORKER_URL;

    const response = await GET(request());
    const body = (await response.json()) as {
      status: string;
      worker: { configured: boolean; ok: boolean; status: string };
    };

    expect(body.status).toBe("degraded");
    expect(body.worker.configured).toBe(false);
    expect(body.worker.ok).toBe(false);
    expect(body.worker.status).toBe("unconfigured");
  });

  it("is disabled by default in production", async () => {
    setTestNodeEnv("production");
    delete process.env.MURMUR_ENABLE_DEBUG_SURFACE;

    const response = await GET(request("https://murmur.example/api/qa/health"));
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

    const response = await GET(request("https://murmur.example/api/qa/health"));
    expect(response.status).toBe(403);
    const body = await response.json() as { error?: string };
    expect(body.error).toBe("forbidden");
  });

  it("allows authenticated loopback smoke checks when production debug is explicitly enabled", async () => {
    setTestNodeEnv("production");
    process.env.MURMUR_ENABLE_DEBUG_SURFACE = "true";
    nextAuth = {
      ok: true,
      user: {
        id: "ci_local_smoke",
        email: null,
        name: "CI Smoke",
        avatarUrl: null,
      },
      source: "local_header",
      sessionId: null,
    };

    const response = await GET(request("http://127.0.0.1:3100/api/qa/health"));
    expect(response.status).toBe(200);
  });
});
