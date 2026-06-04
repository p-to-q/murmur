import { describe, expect, it } from "bun:test";
import {
  AudioWorkerError,
  normalizeWorkerResponse,
  transcribeWithAudioWorker,
} from "@/lib/platform/audio-worker";
import { INSTRUMENT_RANGES } from "@murmur/core/music/instrument-ranges";

describe("audio worker adapter", () => {
  it("normalizes legacy pYIN notes and clamps them to the target instrument", () => {
    const result = normalizeWorkerResponse(
      {
        source: "pyin",
        notes: [
          { pitch: 48, start: 0, duration: 0.4, velocity: 90, confidence: 0.9 },
          { pitch: 50, start: 0.5, duration: 0.4, velocity: 88, confidence: 0.88 },
          { pitch: 52, start: 1, duration: 0.8, velocity: 92, confidence: 0.91 },
        ],
        frameCount: 128,
        diagnostics: {
          denoiseProvider: "deepfilternet",
          denoiseModel: "DeepFilterNet3",
          denoiseMs: 39,
        },
      },
      {
        targetInstrument: "bell",
        workerMs: 42,
      },
    );

    const range = INSTRUMENT_RANGES.bell;
    expect(result.provider).toBe("pyin");
    expect(result.rawNotes).toHaveLength(3);
    expect(result.diagnostics?.frameCount).toBe(128);
    expect(result.diagnostics?.denoiseProvider).toBe("deepfilternet");
    expect(result.diagnostics?.denoiseModel).toBe("DeepFilterNet3");
    expect(result.diagnostics?.denoiseMs).toBe(39);
    expect(result.diagnostics?.rangeClampApplied).toBe(true);
    for (const note of result.cleanMelody.notes) {
      expect(note.pitch).toBeGreaterThanOrEqual(range.lowMidi);
      expect(note.pitch).toBeLessThanOrEqual(range.highMidi);
    }
  });

  it("rejects worker responses with no voiced notes", () => {
    expect(() =>
      normalizeWorkerResponse(
        {
          source: "pyin",
          notes: [],
        },
        {
          targetInstrument: "piano",
          workerMs: 12,
        },
      ),
    ).toThrow(AudioWorkerError);
  });

  it("preserves no_voiced_frames from worker 422 responses", async () => {
    const originalFetch = globalThis.fetch;
    const originalWorkerUrl = process.env.AUDIO_WORKER_URL;
    process.env.AUDIO_WORKER_URL = "http://audio-worker.test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ detail: { error: "no_voiced_frames" } }),
        { status: 422 },
      )) as typeof fetch;

    try {
      await transcribeWithAudioWorker({
        audio: new File(["audio"], "hum.webm", { type: "audio/webm" }),
        targetInstrument: "piano",
        requestId: "req_test",
      });
      throw new Error("expected transcribeWithAudioWorker to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AudioWorkerError);
      expect((error as AudioWorkerError).code).toBe("no_voiced_frames");
      expect((error as AudioWorkerError).status).toBe(422);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWorkerUrl === undefined) {
        delete process.env.AUDIO_WORKER_URL;
      } else {
        process.env.AUDIO_WORKER_URL = originalWorkerUrl;
      }
    }
  });
});
