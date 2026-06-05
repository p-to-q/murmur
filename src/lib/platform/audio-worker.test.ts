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
        contour: {
          timestamps: [0, 0.0232, 0.0464, 0.0696],
          pitchHz: [130.81, 146.83, null, 164.81],
          confidence: [0.91, 0.89, 0.12, 0.93],
          voiced: [true, true, false, true],
          hopSeconds: 0.02322,
        },
        frameCount: 128,
        diagnostics: {
          rmsDbfs: -20.4,
          peakDbfs: -2.1,
          clippingRatio: 0.0003,
          acceptanceScore: 0.81,
          musicFeelScore: 0.78,
          excessiveHoldRatio: 0,
          onsetFragmentation: 0.12,
          firstOnsetLag: 0.04,
          denoiseProvider: "deepfilternet",
          denoiseModel: "DeepFilterNet3",
          denoiseMs: 39,
          noteHypothesis: "balanced",
          hypothesisCandidates: "balanced:2.98,agile:2.76,steady:2.64",
          ensembleCandidates: "pyin/balanced:2.98",
          ensembleDecision: "highest_score",
          ensembleSelected: "pyin/balanced",
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
    expect(result.contour?.timestamps).toHaveLength(4);
    expect(result.contour?.pitchHz[2]).toBeNull();
    expect(result.contour?.voiced[2]).toBe(false);
    expect(result.contour?.hopSeconds).toBeCloseTo(0.02322, 6);
    expect(result.melodies.intent.notes.length).toBeGreaterThan(0);
    expect(result.melodies.corrected).toEqual(result.cleanMelody);
    expect(result.selectedMelodyKind).toBe("corrected");
    expect(result.melodies.musical.duration).toBeGreaterThanOrEqual(
      result.cleanMelody.duration,
    );
    expect(result.diagnostics?.frameCount).toBe(128);
    expect(result.diagnostics?.rmsDbfs).toBe(-20.4);
    expect(result.diagnostics?.peakDbfs).toBe(-2.1);
    expect(result.diagnostics?.clippingRatio).toBe(0.0003);
    expect(result.diagnostics?.acceptanceScore).toBe(0.81);
    expect(result.diagnostics?.musicFeelScore).toBe(0.78);
    expect(result.diagnostics?.firstOnsetLag).toBe(0.04);
    expect(result.diagnostics?.noteHypothesis).toBe("balanced");
    expect(result.diagnostics?.hypothesisCandidates).toContain("balanced");
    expect(result.diagnostics?.ensembleCandidates).toContain("pyin/");
    expect(result.diagnostics?.ensembleDecision).toBe("highest_score");
    expect(result.diagnostics?.ensembleSelected).toBe("pyin/balanced");
    expect(result.diagnostics?.denoiseProvider).toBe("deepfilternet");
    expect(result.diagnostics?.denoiseModel).toBe("DeepFilterNet3");
    expect(result.diagnostics?.denoiseMs).toBe(39);
    expect(result.diagnostics?.selectedMelodyKind).toBe("corrected");
    expect(result.diagnostics?.rangeClampApplied).toBe(true);
    for (const note of result.cleanMelody.notes) {
      expect(note.pitch).toBeGreaterThanOrEqual(range.lowMidi);
      expect(note.pitch).toBeLessThanOrEqual(range.highMidi);
    }
  });

  it("derives frameCount from contour when diagnostics do not include it", () => {
    const result = normalizeWorkerResponse(
      {
        source: "swiftf0",
        notes: [
          { pitch: 60, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.9 },
        ],
        contour: {
          timestamps: [0, 0.01, 0.02],
          pitchHz: [261.63, 261.7, 261.55],
          confidence: [0.92, 0.93, 0.91],
          voiced: [true, true, true],
          hopSeconds: 0.01,
        },
      },
      {
        targetInstrument: "piano",
        workerMs: 9,
      },
    );

    expect(result.diagnostics?.frameCount).toBe(3);
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

  it("switches to musical melody for fragmented low-confidence takes", () => {
    const result = normalizeWorkerResponse(
      {
        source: "swiftf0",
        notes: [
          { pitch: 60, start: 0, duration: 0.12, velocity: 90, confidence: 0.58 },
          { pitch: 62, start: 0.18, duration: 0.14, velocity: 84, confidence: 0.6 },
          { pitch: 64, start: 0.36, duration: 0.12, velocity: 86, confidence: 0.57 },
          { pitch: 65, start: 0.54, duration: 0.16, velocity: 82, confidence: 0.59 },
          { pitch: 67, start: 0.74, duration: 0.12, velocity: 87, confidence: 0.61 },
          { pitch: 69, start: 0.92, duration: 0.14, velocity: 88, confidence: 0.6 },
        ],
        diagnostics: {
          voicedRatio: 0.52,
          snr: 8.5,
        },
      },
      {
        targetInstrument: "piano",
        workerMs: 18,
      },
    );

    expect(result.selectedMelodyKind).toBe("musical");
    expect(result.diagnostics?.selectedMelodyKind).toBe("musical");
    expect(result.melodies.musical.duration).toBeGreaterThanOrEqual(
      result.melodies.corrected.duration,
    );
  });

  it("switches to musical melody when acceptance diagnostics show a poor take", () => {
    const result = normalizeWorkerResponse(
      {
        source: "swiftf0",
        notes: [
          { pitch: 60, start: 0.2, duration: 0.42, velocity: 0.82, confidence: 0.86 },
          { pitch: 62, start: 0.76, duration: 0.84, velocity: 0.78, confidence: 0.72 },
          { pitch: 64, start: 1.72, duration: 0.22, velocity: 0.77, confidence: 0.81 },
          { pitch: 67, start: 2.02, duration: 0.28, velocity: 0.8, confidence: 0.85 },
        ],
        diagnostics: {
          voicedRatio: 0.78,
          snr: 14.2,
          acceptanceScore: 0.47,
          musicFeelScore: 0.49,
          excessiveHoldRatio: 0.34,
          onsetFragmentation: 0.55,
          firstOnsetLag: 0.22,
        },
      },
      {
        targetInstrument: "piano",
        workerMs: 18,
      },
    );

    expect(result.selectedMelodyKind).toBe("musical");
    expect(result.diagnostics?.selectedMelodyKind).toBe("musical");
    expect(result.melodies.musical.notes[1]?.duration).toBeLessThan(0.84);
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
