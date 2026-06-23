import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

let nextMode: "serverless" | "http" | null = null;
let nextWorkerHealth: Response = Response.json({
  status: "ok",
  model: "secret-model",
  mock: false,
  loaded: true,
  loading: false,
  loadError: "internal stack trace",
});

mock.module("@/lib/platform/music-worker", () => ({
  getMusicEngineMode: () => nextMode,
  getMusicServerlessConfig: () =>
    nextMode === "serverless"
      ? { endpointId: "endpoint_test", apiKey: "runpod_key_test" }
      : null,
  getMusicWorkerUrl: () =>
    nextMode === "http" ? "http://127.0.0.1:8002" : null,
  isMusicWorkerConfigured: () => nextMode !== null,
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
    body: { workers: { idle: 0, running: 1 } },
  }),
  runJob: async () => {
    throw new Error("runJob should not be called in health route tests");
  },
}));

const originalFetch = globalThis.fetch;
const { GET } = await import("./route");

beforeEach(() => {
  nextMode = null;
  nextWorkerHealth = Response.json({
    status: "ok",
    model: "secret-model",
    mock: false,
    loaded: true,
    loading: false,
    loadError: "internal stack trace",
  });
  globalThis.fetch = (async () => nextWorkerHealth.clone()) as typeof fetch;
});

describe("GET /api/music/health", () => {
  it("does not expose RunPod worker counts in the public serverless health response", async () => {
    nextMode = "serverless";

    const response = await GET();
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      available: true,
      configured: true,
      mode: "serverless",
      reason: null,
    });
    expect(body.workers).toBeUndefined();
  });

  it("does not expose model or load error details in the public HTTP health response", async () => {
    nextMode = "http";
    nextWorkerHealth = Response.json({
      status: "degraded",
      model: "secret-model",
      mock: true,
      loaded: false,
      loading: false,
      loadError: "private model path failed",
    });

    const response = await GET();
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      available: false,
      configured: true,
      mode: "http",
      reason: "degraded",
    });
    expect(body.model).toBeUndefined();
    expect(body.mock).toBeUndefined();
    expect(body.loaded).toBeUndefined();
    expect(body.loading).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("private model path");
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
