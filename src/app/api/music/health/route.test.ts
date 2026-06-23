import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const originalFetch = globalThis.fetch;

const KEYS = [
  "MUSIC_ENGINE_MODE",
  "RUNPOD_SERVERLESS_ENDPOINT_ID",
  "RUNPOD_API_KEY",
  "MUSIC_WORKER_URL",
  "NODE_ENV",
] as const;

let saved: Record<string, string | undefined>;

const { GET } = await import("./route");

beforeEach(() => {
  saved = {};
  for (const key of KEYS) saved[key] = process.env[key];
  for (const key of KEYS) delete process.env[key];
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function wireServerless() {
  process.env.RUNPOD_SERVERLESS_ENDPOINT_ID = "ep_test";
  process.env.RUNPOD_API_KEY = "rpa_test";
}

describe("GET /api/music/health", () => {
  it("checks the warm pod when production MUSIC_ENGINE_MODE=http is explicit", async () => {
    wireServerless();
    process.env.MUSIC_ENGINE_MODE = "http";
    process.env.MUSIC_WORKER_URL = "https://pod-abc-8002.proxy.runpod.net";

    let requestedUrl = "";
    globalThis.fetch = (async (url) => {
      requestedUrl = String(url);
      return Response.json({
        status: "ok",
        model: "mrt2_base",
        loaded: true,
        loading: false,
      });
    }) as typeof fetch;

    const response = await GET();
    const body = (await response.json()) as {
      available: boolean;
      configured: boolean;
      mode: string;
      requestedMode: string;
      model: string | null;
      loaded: boolean;
      reason: string | null;
    };

    expect(requestedUrl).toBe("https://pod-abc-8002.proxy.runpod.net/health");
    expect(body.available).toBe(true);
    expect(body.configured).toBe(true);
    expect(body.mode).toBe("http");
    expect(body.requestedMode).toBe("http");
    expect(body.model).toBe("mrt2_base");
    expect(body.loaded).toBe(true);
    expect(body.reason).toBeNull();
  });

  it("does not silently report serverless when explicit http mode lacks pod env", async () => {
    wireServerless();
    process.env.MUSIC_ENGINE_MODE = "http";

    const response = await GET();
    const body = (await response.json()) as {
      available: boolean;
      configured: boolean;
      mode: string;
      requestedMode: string;
      reason: string;
    };

    expect(body.available).toBe(false);
    expect(body.configured).toBe(false);
    expect(body.mode).toBe("http");
    expect(body.requestedMode).toBe("http");
    expect(body.reason).toBe("unconfigured");
  });
});
