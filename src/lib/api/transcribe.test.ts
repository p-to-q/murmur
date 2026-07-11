import { afterEach, describe, expect, it } from "bun:test";
import {
  TranscribeRequestError,
  transcribeRecording,
  transcribeRecordingStreaming,
} from "@/lib/api/transcribe";
import { createFetchMock } from "@/test-utils/fetch";

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
    globalThis.fetch = createFetchMock(async () =>
      jsonResponse(
        {
          error: "insufficient_notes",
          message: "Not enough Murmur Notes",
          requestId: "req_402",
          currentBalance: 0,
          cost: 1,
        },
        402,
      ));

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
    globalThis.fetch = createFetchMock(async () =>
      jsonResponse(
        {
          error: "no_voiced_frames",
          message: "no voiced notes",
          requestId: "req_422",
        },
        422,
      ));

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
    globalThis.fetch = createFetchMock(async () =>
      jsonResponse(
        {
          error: "worker_http_error",
          message: "Audio worker returned HTTP 503",
          requestId: "req_502",
        },
        502,
      ));

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
    globalThis.fetch = createFetchMock(async () =>
      jsonResponse(
        {
          error: "worker_unconfigured",
          message: "AUDIO_WORKER_URL is not configured",
          requestId: "req_unconfigured",
        },
        503,
      ));

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
    globalThis.fetch = createFetchMock(async () =>
      jsonResponse(
        {
          error: "billing_unavailable",
          message: "User balance is unavailable",
          requestId: "req_billing",
        },
        503,
      ));

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

  it("maps auth failures separately from worker outages", async () => {
    globalThis.fetch = createFetchMock(async () =>
      jsonResponse(
        {
          error: "unauthorized",
          message: "Authentication required",
        },
        401,
      ));

    try {
      await transcribeRecording(blob());
      throw new Error("expected transcribeRecording to throw");
    } catch (error) {
      const typed = error as TranscribeRequestError;
      expect(typed.code).toBe("unauthorized");
      expect(typed.status).toBe(401);
    }
  });

  it("falls back to status-derived codes when the body lacks a typed error", async () => {
    globalThis.fetch = createFetchMock(async () => new Response("nope", { status: 429 }));
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
    globalThis.fetch = createFetchMock(async () => {
      throw new TypeError("Failed to fetch");
    });

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

function ndjsonResponse(lines: string[]): Response {
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: { "Content-Type": "text/x-ndjson; charset=utf-8" },
  });
}

describe("transcribeRecordingStreaming NDJSON consumer (#224)", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("dispatches progress phases and returns the completed result", async () => {
    const phases: string[] = [];
    globalThis.fetch = createFetchMock(async () =>
      ndjsonResponse([
        JSON.stringify({ phase: "billing_ok", balanceBefore: 9 }),
        JSON.stringify({ phase: "worker_started" }),
        JSON.stringify({ phase: "complete", result: { provider: "swiftf0" } }),
      ]));

    const result = await transcribeRecordingStreaming(blob(), {
      onProgress: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["billing_ok", "worker_started", "complete"]);
    expect((result as { provider: string }).provider).toBe("swiftf0");
  });

  it("skips an unparseable (non-JSON) line instead of rejecting the transcription", async () => {
    globalThis.fetch = createFetchMock(async () =>
      ndjsonResponse([
        JSON.stringify({ phase: "billing_ok", balanceBefore: 9 }),
        "<html>502 Bad Gateway</html>",
        JSON.stringify({ phase: "complete", result: { provider: "rmvpe" } }),
      ]));

    const result = await transcribeRecordingStreaming(blob());
    expect((result as { provider: string }).provider).toBe("rmvpe");
  });

  it("skips a well-formed line with an unrecognized phase (schema mismatch)", async () => {
    const phases: string[] = [];
    globalThis.fetch = createFetchMock(async () =>
      ndjsonResponse([
        // A future/foreign event shape must not be dispatched to onProgress.
        JSON.stringify({ phase: "interim_melody", melody: { notes: "bad" } }),
        JSON.stringify({
          phase: "interim_melody",
          melody: {
            notes: [{ pitch: 60, start: 0, duration: 1, velocity: 0.8, confidence: 0.9 }],
            key: "C",
            scale: "not-a-scale",
            bpm: 100,
            duration: 1,
            contour: "flat",
          },
        }),
        JSON.stringify({
          phase: "interim_melody",
          melody: {
            notes: [{ pitch: "60", start: 0, duration: 1, velocity: 0.8, confidence: 0.9 }],
            key: "C",
            scale: "major",
            bpm: 100,
            duration: 1,
            contour: "flat",
          },
        }),
        JSON.stringify({ phase: "worker_started" }),
        JSON.stringify({ phase: "complete", result: { provider: "swiftf0" } }),
      ]));

    const result = await transcribeRecordingStreaming(blob(), {
      onProgress: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["worker_started", "complete"]);
    expect((result as { provider: string }).provider).toBe("swiftf0");
  });

  it("dispatches a fully validated interim melody", async () => {
    const progress: Array<{ phase: string; data: unknown }> = [];
    const melody = {
      notes: [{ pitch: 60, start: 0, duration: 1, velocity: 0.8, confidence: 0.9 }],
      key: "C",
      scale: "major",
      bpm: 100,
      duration: 1,
      contour: "flat",
    };
    globalThis.fetch = createFetchMock(async () =>
      ndjsonResponse([
        JSON.stringify({ phase: "interim_melody", melody }),
        JSON.stringify({ phase: "complete", result: { provider: "swiftf0" } }),
      ]));

    await transcribeRecordingStreaming(blob(), {
      onProgress: (phase, data) => progress.push({ phase, data }),
    });

    expect(progress[0]).toEqual({ phase: "interim_melody", data: melody });
  });

  it("skips a malformed error event (missing fields) rather than throwing a bogus typed error", async () => {
    globalThis.fetch = createFetchMock(async () =>
      ndjsonResponse([
        // Missing message/status/requestId — not a usable error event.
        JSON.stringify({ phase: "error", error: "server_error" }),
        JSON.stringify({ phase: "complete", result: { provider: "swiftf0" } }),
      ]));

    const result = await transcribeRecordingStreaming(blob());
    expect((result as { provider: string }).provider).toBe("swiftf0");
  });

  it("still surfaces a well-formed error event as a typed transport error", async () => {
    globalThis.fetch = createFetchMock(async () =>
      ndjsonResponse([
        JSON.stringify({ phase: "billing_ok", balanceBefore: 0 }),
        JSON.stringify({
          phase: "error",
          error: "insufficient_notes",
          message: "Not enough Murmur Notes",
          status: 402,
          requestId: "req_stream_402",
          currentBalance: 0,
        }),
      ]));

    try {
      await transcribeRecordingStreaming(blob());
      throw new Error("expected transcribeRecordingStreaming to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TranscribeRequestError);
      const typed = error as TranscribeRequestError;
      expect(typed.code).toBe("insufficient_notes");
      expect(typed.status).toBe(402);
      expect(typed.requestId).toBe("req_stream_402");
      expect(typed.currentBalance).toBe(0);
    }
  });

  it("does not reject the transcription when onProgress throws (keeps the client-pitch fallback reachable)", async () => {
    globalThis.fetch = createFetchMock(async () =>
      ndjsonResponse([
        JSON.stringify({ phase: "billing_ok", balanceBefore: 9 }),
        JSON.stringify({ phase: "worker_started" }),
        JSON.stringify({ phase: "complete", result: { provider: "swiftf0" } }),
      ]));

    const result = await transcribeRecordingStreaming(blob(), {
      onProgress: () => {
        throw new Error("UI blew up while updating the phase indicator");
      },
    });

    // A throwing progress handler must never convert a successful transcription
    // into a rejection (which upstream would not classify as a network error,
    // skipping the fallback the user already paid a note for).
    expect((result as { provider: string }).provider).toBe("swiftf0");
  });
});
