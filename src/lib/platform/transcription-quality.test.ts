import { describe, expect, it } from "bun:test";
import { normalizeWorkerResponse } from "@/lib/platform/audio-worker";
import type { TranscriptionProvider } from "@/modules/shared/types";

/**
 * Transcription quality test set.
 *
 * Each case is a frozen audio-worker response representing a real humming
 * pattern. The assertions check that the melody-polisher + humming-engine
 * pipeline preserves essential musical properties when the upstream worker
 * response shape or scoring changes.
 *
 * To add a new golden case: capture a real worker JSON response, extract
 * the fields below, and define expected bounds. Run with `bun test` to
 * verify the baselines pass, then commit.
 */

type GoldenCase = {
  name: string;
  workerResponse: {
    provider?: string;
    source?: string;
    rawNotes?: Array<{ pitch: number; start: number; duration: number; velocity?: number; confidence?: number }>;
    notes?: Array<{ pitch: number; start: number; duration: number; velocity?: number; confidence?: number }>;
    contour?: {
      timestamps: number[];
      pitchHz: Array<number | null>;
      confidence: number[];
      voiced: boolean[];
      hopSeconds: number;
    };
    cleanMelody?: {
      notes: Array<{ pitch: number; start: number; duration: number; velocity?: number; confidence?: number }>;
      key: string;
      scale: "major" | "minor" | "pentatonic" | "dorian" | "phrygian";
      bpm: number;
      duration: number;
      contour: "rising" | "falling" | "wave" | "flat";
    };
    diagnostics?: Record<string, unknown>;
    warnings?: string[];
    frameCount?: number;
  };
  expected: {
    provider: TranscriptionProvider;
    noteCountRange: [number, number];
    keyOptions?: string[];
    scaleOptions?: Array<"major" | "minor" | "pentatonic" | "dorian" | "phrygian">;
    contourOptions?: Array<"rising" | "falling" | "wave" | "flat">;
    bpmRange?: [number, number];
    durationRange?: [number, number];
    selectedMelodyKind?: Array<"intent" | "corrected" | "musical">;
  };
};

const GOLDEN_CASES: GoldenCase[] = [
  {
    name: "C minor ascending hum — melancholy rise, 7 notes",
    workerResponse: {
      source: "rmvpe",
      rawNotes: [
        { pitch: 60, start: 0.0, duration: 0.45, velocity: 83, confidence: 0.93 },
        { pitch: 63, start: 0.5, duration: 0.45, velocity: 83, confidence: 0.91 },
        { pitch: 65, start: 1.0, duration: 0.45, velocity: 87, confidence: 0.92 },
        { pitch: 67, start: 1.5, duration: 0.7, velocity: 91, confidence: 0.94 },
        { pitch: 65, start: 2.25, duration: 0.45, velocity: 83, confidence: 0.90 },
        { pitch: 63, start: 2.75, duration: 0.45, velocity: 79, confidence: 0.89 },
        { pitch: 60, start: 3.25, duration: 1.0, velocity: 87, confidence: 0.95 },
      ],
      diagnostics: {
        snr: 18.5,
        voicedRatio: 0.72,
        denoiseProvider: "deepfilternet",
        rmvpeDevice: "cpu",
      },
    },
    expected: {
      provider: "rmvpe",
      noteCountRange: [5, 9],
      scaleOptions: ["minor", "dorian"],
      contourOptions: ["wave", "rising"],
      bpmRange: [80, 160],
      durationRange: [3.0, 6.0],
    },
  },
  {
    name: "G major bright jump — 7 notes, upward then down",
    workerResponse: {
      source: "rmvpe",
      rawNotes: [
        { pitch: 67, start: 0.0, duration: 0.35, velocity: 91, confidence: 0.92 },
        { pitch: 69, start: 0.4, duration: 0.35, velocity: 89, confidence: 0.91 },
        { pitch: 71, start: 0.8, duration: 0.35, velocity: 94, confidence: 0.93 },
        { pitch: 72, start: 1.2, duration: 0.6, velocity: 99, confidence: 0.95 },
        { pitch: 71, start: 1.85, duration: 0.35, velocity: 87, confidence: 0.90 },
        { pitch: 69, start: 2.25, duration: 0.35, velocity: 83, confidence: 0.89 },
        { pitch: 67, start: 2.65, duration: 0.9, velocity: 89, confidence: 0.94 },
      ],
      diagnostics: {
        snr: 22.1,
        voicedRatio: 0.68,
        denoiseProvider: "deepfilternet",
      },
    },
    expected: {
      provider: "rmvpe",
      noteCountRange: [5, 9],
      scaleOptions: ["major", "pentatonic"],
      contourOptions: ["wave", "flat"],
      bpmRange: [60, 180],
      durationRange: [2.5, 5.0],
    },
  },
  {
    name: "A minor wave — 7 notes, undulating",
    workerResponse: {
      source: "pyin",
      rawNotes: [
        { pitch: 69, start: 0.0, duration: 0.5, velocity: 87, confidence: 0.91 },
        { pitch: 67, start: 0.55, duration: 0.4, velocity: 83, confidence: 0.90 },
        { pitch: 65, start: 1.0, duration: 0.4, velocity: 80, confidence: 0.88 },
        { pitch: 67, start: 1.45, duration: 0.55, velocity: 87, confidence: 0.92 },
        { pitch: 69, start: 2.05, duration: 0.4, velocity: 89, confidence: 0.91 },
        { pitch: 72, start: 2.5, duration: 0.7, velocity: 94, confidence: 0.93 },
        { pitch: 69, start: 3.25, duration: 1.0, velocity: 83, confidence: 0.94 },
      ],
      diagnostics: {
        snr: 15.2,
        voicedRatio: 0.65,
      },
    },
    expected: {
      provider: "pyin",
      noteCountRange: [5, 9],
      scaleOptions: ["minor", "dorian", "pentatonic"],
      contourOptions: ["wave"],
      bpmRange: [70, 160],
      durationRange: [3.0, 6.0],
    },
  },
  {
    name: "D minor descending — 7 notes, sentimental fall",
    workerResponse: {
      source: "rmvpe",
      rawNotes: [
        { pitch: 74, start: 0.0, duration: 0.45, velocity: 89, confidence: 0.92 },
        { pitch: 72, start: 0.5, duration: 0.45, velocity: 85, confidence: 0.90 },
        { pitch: 69, start: 1.0, duration: 0.45, velocity: 83, confidence: 0.91 },
        { pitch: 67, start: 1.5, duration: 0.65, velocity: 87, confidence: 0.93 },
        { pitch: 65, start: 2.2, duration: 0.45, velocity: 80, confidence: 0.89 },
        { pitch: 62, start: 2.7, duration: 0.45, velocity: 76, confidence: 0.88 },
        { pitch: 62, start: 3.2, duration: 1.0, velocity: 83, confidence: 0.94 },
      ],
      diagnostics: {
        snr: 20.3,
        voicedRatio: 0.70,
        rmvpeDevice: "cpu",
      },
    },
    expected: {
      provider: "rmvpe",
      noteCountRange: [5, 9],
      scaleOptions: ["minor", "dorian", "phrygian"],
      contourOptions: ["falling", "wave"],
      bpmRange: [70, 150],
      durationRange: [3.0, 6.0],
    },
  },
  {
    name: "Short hum — 3 notes, minimal input",
    workerResponse: {
      source: "rmvpe",
      rawNotes: [
        { pitch: 60, start: 0.0, duration: 0.6, velocity: 85, confidence: 0.90 },
        { pitch: 64, start: 0.7, duration: 0.5, velocity: 88, confidence: 0.92 },
        { pitch: 67, start: 1.3, duration: 0.8, velocity: 90, confidence: 0.93 },
      ],
      diagnostics: {
        snr: 12.0,
        voicedRatio: 0.45,
      },
    },
    expected: {
      provider: "rmvpe",
      noteCountRange: [3, 5],
      scaleOptions: ["major", "pentatonic"],
      contourOptions: ["rising"],
      bpmRange: [60, 180],
      durationRange: [1.5, 4.0],
    },
  },
  {
    name: "Noisy low-confidence hum — weaker signal",
    workerResponse: {
      source: "pyin",
      rawNotes: [
        { pitch: 55, start: 0.0, duration: 0.5, velocity: 70, confidence: 0.72 },
        { pitch: 57, start: 0.6, duration: 0.4, velocity: 68, confidence: 0.68 },
        { pitch: 60, start: 1.1, duration: 0.5, velocity: 72, confidence: 0.75 },
        { pitch: 62, start: 1.7, duration: 0.6, velocity: 74, confidence: 0.78 },
        { pitch: 60, start: 2.4, duration: 0.8, velocity: 70, confidence: 0.73 },
      ],
      diagnostics: {
        snr: 6.5,
        voicedRatio: 0.42,
      },
    },
    expected: {
      provider: "pyin",
      noteCountRange: [3, 7],
      bpmRange: [50, 180],
      durationRange: [2.0, 5.0],
    },
  },
];

describe("transcription quality test set", () => {
  for (const tc of GOLDEN_CASES) {
    describe(tc.name, () => {
      const result = normalizeWorkerResponse(
        tc.workerResponse as Parameters<typeof normalizeWorkerResponse>[0],
        { targetInstrument: "piano", workerMs: 100 },
      );

      it("detects the correct provider", () => {
        expect(result.provider).toBe(tc.expected.provider);
      });

      it(`produces ${tc.expected.noteCountRange[0]}-${tc.expected.noteCountRange[1]} clean notes`, () => {
        const count = result.cleanMelody.notes.length;
        expect(count).toBeGreaterThanOrEqual(tc.expected.noteCountRange[0]);
        expect(count).toBeLessThanOrEqual(tc.expected.noteCountRange[1]);
      });

      if (tc.expected.keyOptions) {
        it(`key is one of [${tc.expected.keyOptions.join(", ")}]`, () => {
          expect(tc.expected.keyOptions).toContain(result.cleanMelody.key);
        });
      }

      if (tc.expected.scaleOptions) {
        it(`scale is one of [${tc.expected.scaleOptions.join(", ")}]`, () => {
          expect(tc.expected.scaleOptions).toContain(result.cleanMelody.scale);
        });
      }

      if (tc.expected.contourOptions) {
        it(`contour is one of [${tc.expected.contourOptions.join(", ")}]`, () => {
          expect(tc.expected.contourOptions).toContain(result.cleanMelody.contour);
        });
      }

      if (tc.expected.bpmRange) {
        it(`BPM is within [${tc.expected.bpmRange[0]}, ${tc.expected.bpmRange[1]}]`, () => {
          expect(result.cleanMelody.bpm).toBeGreaterThanOrEqual(tc.expected.bpmRange![0]);
          expect(result.cleanMelody.bpm).toBeLessThanOrEqual(tc.expected.bpmRange![1]);
        });
      }

      if (tc.expected.durationRange) {
        it(`duration is within [${tc.expected.durationRange[0]}s, ${tc.expected.durationRange[1]}s]`, () => {
          expect(result.cleanMelody.duration).toBeGreaterThanOrEqual(tc.expected.durationRange![0]);
          expect(result.cleanMelody.duration).toBeLessThanOrEqual(tc.expected.durationRange![1]);
        });
      }

      if (tc.expected.selectedMelodyKind) {
        it(`selected melody kind is one of [${tc.expected.selectedMelodyKind.join(", ")}]`, () => {
          expect(tc.expected.selectedMelodyKind).toContain(result.selectedMelodyKind);
        });
      }

      it("produces three melody variants (intent, corrected, musical)", () => {
        expect(result.melodies.intent.notes.length).toBeGreaterThan(0);
        expect(result.melodies.corrected.notes.length).toBeGreaterThan(0);
        expect(result.melodies.musical.notes.length).toBeGreaterThan(0);
      });

      it("all notes have valid pitch, start, duration", () => {
        for (const note of result.cleanMelody.notes) {
          expect(note.pitch).toBeGreaterThanOrEqual(21);
          expect(note.pitch).toBeLessThanOrEqual(108);
          expect(note.start).toBeGreaterThanOrEqual(0);
          expect(note.duration).toBeGreaterThan(0);
          expect(note.velocity).toBeGreaterThan(0);
          expect(note.velocity).toBeLessThanOrEqual(1);
        }
      });
    });
  }
});
