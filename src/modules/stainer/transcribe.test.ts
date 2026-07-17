import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { TranscriptionResult } from "@/modules/shared/types";

let transcribeError: unknown = null;
let clientAvailable = true;
let detectPitchCalls = 0;

class MockTranscribeRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(init: { code: string; status: number; message: string }) {
    super(init.message);
    this.name = "TranscribeRequestError";
    this.code = init.code;
    this.status = init.status;
  }
}

const fallbackResult: TranscriptionResult = {
  provider: "client_pyin",
  rawNotes: [
    { pitch: 60, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 },
  ],
  cleanMelody: {
    notes: [
      { pitch: 60, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 },
    ],
    key: "C",
    scale: "major",
    bpm: 90,
    duration: 0.5,
    contour: "flat",
  },
  melodies: {
    intent: {
      notes: [{ pitch: 60, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 }],
      key: "C", scale: "major", bpm: 90, duration: 0.5, contour: "flat",
    },
    corrected: {
      notes: [{ pitch: 60, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 }],
      key: "C", scale: "major", bpm: 90, duration: 0.5, contour: "flat",
    },
    musical: {
      notes: [{ pitch: 60, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 }],
      key: "C", scale: "major", bpm: 90, duration: 0.5, contour: "flat",
    },
  },
  selectedMelodyKind: "corrected",
  warnings: [],
  diagnostics: { duration: 0.5, snr: null, voicedRatio: null },
};

mock.module("@/lib/api/transcribe", () => ({
  TranscribeRequestError: MockTranscribeRequestError,
  transcribeRecording: async () => {
    if (transcribeError) throw transcribeError;
    return {
      ...fallbackResult,
      provider: "audio-worker",
    };
  },
  transcribeRecordingStreaming: async () => {
    if (transcribeError) throw transcribeError;
    return {
      ...fallbackResult,
      provider: "audio-worker",
    };
  },
}));

mock.module("@/lib/audio/client-pitch-fallback", () => ({
  isClientPitchAvailable: async () => clientAvailable,
  detectPitchClient: async () => {
    detectPitchCalls += 1;
    return {
      provider: "client_pyin" as const,
      rawNotes: fallbackResult.rawNotes,
      diagnostics: {
        totalMs: 12,
        sampleRate: 44100,
        frameCount: 20,
        voicedFrames: 12,
      },
    };
  },
}));

const { transcribeWithStainer } = await import("./transcribe");

describe("transcribeWithStainer fallback facade", () => {
  beforeEach(() => {
    transcribeError = null;
    clientAvailable = true;
    detectPitchCalls = 0;
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: class {
        async decodeAudioData() {
          return {} as AudioBuffer;
        }

        async close() {}
      },
    });
  });

  it("uses client pitch fallback for transient network failures", async () => {
    transcribeError = new Error("503 Service Unavailable");

    const result = await transcribeWithStainer({
      audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      targetInstrument: "piano",
    });

    expect(result.provider).toBe("client_pyin");
    expect(result.rawNotes).toHaveLength(1);
    expect(detectPitchCalls).toBe(1);
  });

  it("uses client pitch fallback for typed worker timeouts", async () => {
    transcribeError = new MockTranscribeRequestError({
      code: "worker_unavailable",
      status: 0,
      message: "Transcription request timed out",
    });

    const result = await transcribeWithStainer({
      audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      targetInstrument: "piano",
    });

    expect(result.provider).toBe("client_pyin");
    expect(detectPitchCalls).toBe(1);
  });

  it("passes non-network transcription errors through", async () => {
    const error = new Error("invalid audio payload");
    transcribeError = error;

    await expect(
      transcribeWithStainer({
        audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      }),
    ).rejects.toBe(error);
    expect(detectPitchCalls).toBe(0);
  });

  it("passes the original network error through when client fallback is unavailable", async () => {
    const error = new TypeError("fetch failed");
    transcribeError = error;
    clientAvailable = false;

    await expect(
      transcribeWithStainer({
        audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      }),
    ).rejects.toBe(error);
    expect(detectPitchCalls).toBe(0);
  });
});
