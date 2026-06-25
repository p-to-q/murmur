import { afterEach, describe, expect, it } from "bun:test";
import { analyzeRecording, CaptureAnalyzeError } from "./capture";

const originalFetch = globalThis.fetch;

function blob(): Blob {
  return new Blob([new Uint8Array(8)], { type: "audio/webm" });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("analyzeRecording typed error mapping", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("preserves insufficient_notes with balance details", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        error: "insufficient_notes",
        message: "Not enough Murmur Notes",
        requestId: "req_capture_402",
        currentBalance: 0,
      }, 402)) as typeof fetch;

    try {
      await analyzeRecording(blob());
      throw new Error("expected analyzeRecording to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CaptureAnalyzeError);
      const typed = error as CaptureAnalyzeError;
      expect(typed.code).toBe("insufficient_notes");
      expect(typed.status).toBe(402);
      expect(typed.requestId).toBe("req_capture_402");
      expect(typed.currentBalance).toBe(0);
    }
  });

  it("collapses worker HTTP failures into worker_unavailable", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        error: "worker_http_error",
        message: "Audio worker unavailable",
        requestId: "req_capture_502",
      }, 502)) as typeof fetch;

    try {
      await analyzeRecording(blob());
      throw new Error("expected analyzeRecording to throw");
    } catch (error) {
      const typed = error as CaptureAnalyzeError;
      expect(typed.code).toBe("worker_unavailable");
      expect(typed.status).toBe(502);
      expect(typed.requestId).toBe("req_capture_502");
    }
  });

  it("wraps low-level fetch failures as network_error", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    try {
      await analyzeRecording(blob());
      throw new Error("expected analyzeRecording to throw");
    } catch (error) {
      const typed = error as CaptureAnalyzeError;
      expect(typed.code).toBe("network_error");
      expect(typed.status).toBe(0);
    }
  });
});
