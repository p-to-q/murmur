import { beforeEach, describe, expect, it } from "bun:test";
import type { TranscriptionResult } from "@/modules/shared/types";
import { TranscribeRequestError } from "@/lib/api/transcribe";
import { transcribeWithStainer } from "./transcribe";

let transcribeError: unknown = null;
let clientAvailable = true;
let detectPitchCalls = 0;

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

const dependencies = {
  transcribeRecording: async (): Promise<TranscriptionResult> => {
    if (transcribeError) throw transcribeError;
    return {
      ...fallbackResult,
      provider: "swiftf0",
    };
  },
  transcribeRecordingStreaming: async (): Promise<TranscriptionResult> => {
    if (transcribeError) throw transcribeError;
    return {
      ...fallbackResult,
      provider: "swiftf0",
    };
  },
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
  decodeAudioBlob: async () => ({} as AudioBuffer),
};

describe("transcribeWithStainer fallback facade", () => {
  beforeEach(() => {
    transcribeError = null;
    clientAvailable = true;
    detectPitchCalls = 0;
  });

  it("uses client pitch fallback for transient network failures", async () => {
    transcribeError = new Error("503 Service Unavailable");

    const result = await transcribeWithStainer({
      audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      targetInstrument: "piano",
    }, dependencies);

    expect(result.provider).toBe("client_pyin");
    expect(result.rawNotes).toHaveLength(1);
    expect(detectPitchCalls).toBe(1);
  });

  it("uses client pitch fallback for typed worker timeouts", async () => {
    transcribeError = new TranscribeRequestError({
      code: "worker_unavailable",
      status: 0,
      message: "Transcription request timed out",
    });

    const result = await transcribeWithStainer({
      audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      targetInstrument: "piano",
    }, dependencies);

    expect(result.provider).toBe("client_pyin");
    expect(detectPitchCalls).toBe(1);
  });

  it("passes non-network transcription errors through", async () => {
    const error = new Error("invalid audio payload");
    transcribeError = error;

    await expect(
      transcribeWithStainer({
        audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      }, dependencies),
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
      }, dependencies),
    ).rejects.toBe(error);
    expect(detectPitchCalls).toBe(0);
  });
});
