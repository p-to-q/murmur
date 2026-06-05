import { afterEach, describe, expect, it } from "bun:test";
import {
  TranscribeRequestError,
  transcribeRecording,
} from "@/lib/api/transcribe";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function blob(): Blob {
  return new Blob([new Uint8Array(8)], { type: "audio/webm" });
}

describe("transcribeRecording typed error mapping", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps 402 insufficient_notes into a typed error with balance", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        {
          error: "insufficient_notes",
          message: "Not enough Murmur Notes",
          requestId: "req_402",
          currentBalance: 0,
          cost: 1,
        },
        402,
      )) as typeof fetch;

    try {
      await transcribeRecording(blob());
      throw new Error("expected transcribeRecording to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TranscribeRequestError);
      const typed = error as TranscribeRequestError;
      expect(typed.code).toBe("insufficient_notes");
      expect(typed.status).toBe(402);
      expect(typed.requestId).toBe("req_402");
      expect(typed.currentBalance).toBe(0);
    }
  });

  it("maps the worker's no_voiced_frames 422 to the same client code", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        {
          error: "no_voiced_frames",
          message: "no voiced notes",
          requestId: "req_422",
        },
        422,
      )) as typeof fetch;

    try {
      await transcribeRecording(blob());
      throw new Error("expected transcribeRecording to throw");
    } catch (error) {
      const typed = error as TranscribeRequestError;
      expect(typed.code).toBe("no_voiced_frames");
      expect(typed.status).toBe(422);
    }
  });

  it("collapses unexpected worker http errors into worker_unavailable", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        {
          error: "worker_http_error",
          message: "Audio worker returned HTTP 503",
          requestId: "req_502",
        },
        502,
      )) as typeof fetch;

    try {
      await transcribeRecording(blob());
      throw new Error("expected transcribeRecording to throw");
    } catch (error) {
      const typed = error as TranscribeRequestError;
      expect(typed.code).toBe("worker_unavailable");
      expect(typed.status).toBe(502);
    }
  });

  it("preserves worker_unconfigured so the UI can explain local setup issues", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        {
          error: "worker_unconfigured",
          message: "AUDIO_WORKER_URL is not configured",
          requestId: "req_unconfigured",
        },
        503,
      )) as typeof fetch;

    try {
      await transcribeRecording(blob());
      throw new Error("expected transcribeRecording to throw");
    } catch (error) {
      const typed = error as TranscribeRequestError;
      expect(typed.code).toBe("worker_unconfigured");
      expect(typed.status).toBe(503);
      expect(typed.requestId).toBe("req_unconfigured");
    }
  });

  it("preserves billing_unavailable so local and prod copy stay honest", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        {
          error: "billing_unavailable",
          message: "User balance is unavailable",
          requestId: "req_billing",
        },
        503,
      )) as typeof fetch;

    try {
      await transcribeRecording(blob());
      throw new Error("expected transcribeRecording to throw");
    } catch (error) {
      const typed = error as TranscribeRequestError;
      expect(typed.code).toBe("billing_unavailable");
      expect(typed.status).toBe(503);
      expect(typed.requestId).toBe("req_billing");
    }
  });

  it("falls back to status-derived codes when the body lacks a typed error", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 429 })) as typeof fetch;
    try {
      await transcribeRecording(blob());
      throw new Error("expected transcribeRecording to throw");
    } catch (error) {
      const typed = error as TranscribeRequestError;
      expect(typed.code).toBe("rate_limited");
      expect(typed.status).toBe(429);
    }
  });

  it("wraps low-level fetch failures as network_error", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    try {
      await transcribeRecording(blob());
      throw new Error("expected transcribeRecording to throw");
    } catch (error) {
      const typed = error as TranscribeRequestError;
      expect(typed.code).toBe("network_error");
      expect(typed.status).toBe(0);
    }
  });
});
