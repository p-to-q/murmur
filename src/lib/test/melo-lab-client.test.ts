import { afterEach, describe, expect, it } from "bun:test";
import {
  filenameForBlob,
  generateMeloLabMusic,
  transcribeMeloLabProvider,
} from "@/lib/test/melo-lab-client";
import type { CleanMelody } from "@/modules/shared/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("MeLo Lab client adapter", () => {
  it("normalizes provider errors into provider run results", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: { message: "worker unavailable" } }), {
        status: 503,
      })) as typeof fetch;

    const result = await transcribeMeloLabProvider(
      new Blob(["audio"], { type: "audio/webm" }),
      "yin",
    );

    expect(result.status).toBe("error");
    expect(result.provider).toBe("yin");
    expect(result.error).toBe("worker unavailable");
  });

  it("returns generated music bytes and response metadata", async () => {
    let receivedForm: FormData | null = null;
    globalThis.fetch = (async (_url, init) => {
      receivedForm = init?.body as FormData;
      return new Response(new Blob(["music"], { type: "audio/wav" }), {
        status: 200,
        headers: {
          "x-model": "local-music",
          "x-generation-ms": "42",
          "x-melody-conditioned": "true",
          "x-cfg-notes": "ok",
        },
      });
    }) as typeof fetch;

    const melody: CleanMelody = {
      notes: [],
      bpm: 90,
      key: "C",
      scale: "major",
      duration: 2,
      contour: "flat",
    };

    const result = await generateMeloLabMusic({
      prompt: "plain piano",
      durationSeconds: 2,
      styleMix: 0,
      melody,
    });

    expect(await result.blob.text()).toBe("music");
    expect(result.model).toBe("local-music");
    expect(result.generationMs).toBe("42");
    expect(result.melodyConditioned).toBe("true");
    expect(result.cfgNotes).toBe("ok");
    expect(receivedForm?.get("prompt")).toBe("plain piano");
    expect(receivedForm?.get("duration")).toBe("2");
    expect(receivedForm?.get("hum")).toBeNull();
  });

  it("chooses stable filenames for common audio blobs", () => {
    expect(filenameForBlob(new Blob([], { type: "audio/webm" }))).toBe("hum.webm");
    expect(filenameForBlob(new Blob([], { type: "audio/mp4" }))).toBe("hum.m4a");
    expect(filenameForBlob(new Blob([], { type: "audio/wav" }))).toBe("hum.wav");
    expect(filenameForBlob(new Blob([], { type: "application/octet-stream" }))).toBe(
      "hum.audio",
    );
  });
});
