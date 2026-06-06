import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const originalFetch = globalThis.fetch;
const originalWorkerUrl = process.env.AUDIO_WORKER_URL;
const { GET } = await import("./route");

beforeEach(() => {
  process.env.AUDIO_WORKER_URL = "http://worker.test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWorkerUrl === undefined) {
    delete process.env.AUDIO_WORKER_URL;
  } else {
    process.env.AUDIO_WORKER_URL = originalWorkerUrl;
  }
});

describe("GET /api/qa/health", () => {
  it("returns an ok health snapshot when the worker responds healthy", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        status: "ok",
        service: "murmur-audio-engine",
      })) as typeof fetch;

    const response = await GET();
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

    const response = await GET();
    const body = (await response.json()) as {
      status: string;
      worker: { configured: boolean; ok: boolean; status: string };
    };

    expect(body.status).toBe("degraded");
    expect(body.worker.configured).toBe(false);
    expect(body.worker.ok).toBe(false);
    expect(body.worker.status).toBe("unconfigured");
  });
});
