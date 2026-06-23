import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { NextRequest } from "next/server";

const originalFetch = globalThis.fetch;
const originalWorkerUrl = process.env.AUDIO_WORKER_URL;
const originalNodeEnv = process.env.NODE_ENV;
const { GET } = await import("./route");

beforeEach(() => {
  process.env.AUDIO_WORKER_URL = "http://worker.test";
  if (process.env.NODE_ENV === "production") {
    process.env.NODE_ENV = "test";
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWorkerUrl === undefined) {
    delete process.env.AUDIO_WORKER_URL;
  } else {
    process.env.AUDIO_WORKER_URL = originalWorkerUrl;
  }
  process.env.NODE_ENV = originalNodeEnv;
});

describe("GET /api/qa/health", () => {
  it("returns an ok health snapshot when the worker responds healthy", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        status: "ok",
        service: "murmur-audio-engine",
      })) as typeof fetch;

    const response = await GET(buildRequest());
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

    const response = await GET(buildRequest());
    const body = (await response.json()) as {
      status: string;
      worker: { configured: boolean; ok: boolean; status: string };
    };

    expect(body.status).toBe("degraded");
    expect(body.worker.configured).toBe(false);
    expect(body.worker.ok).toBe(false);
    expect(body.worker.status).toBe("unconfigured");
  });

  it("does not expose QA details on public production hosts", async () => {
    process.env.NODE_ENV = "production";

    const response = await GET(buildRequest("https://murmur.example/api/qa/health"));

    expect(response.status).toBe(404);
  });

  it("keeps loopback production smoke checks usable", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.AUDIO_WORKER_URL;

    const response = await GET(buildRequest("http://127.0.0.1:3000/api/qa/health"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      worker: { configured: boolean; url?: string | null };
    };
    expect(body.worker.configured).toBe(false);
    expect(body.worker.url).toBeNull();
  });
});

function buildRequest(url = "http://test.local/api/qa/health"): NextRequest {
  return new Request(url) as unknown as NextRequest;
}
