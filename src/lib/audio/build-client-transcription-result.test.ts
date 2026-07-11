import { describe, expect, it } from "bun:test";
import { buildClientTranscriptionResult } from "./build-client-transcription-result";
import type { MelodyNote } from "@/modules/shared/types";

const rawNotes: MelodyNote[] = [
  { pitch: 60, start: 0, duration: 0.4, velocity: 0.8, confidence: 0.92 },
  { pitch: 64, start: 1.25, duration: 0.5, velocity: 0.75, confidence: 0.88 },
  { pitch: 67, start: 0.5, duration: 0.55, velocity: 0.82, confidence: 0.9 },
];

describe("buildClientTranscriptionResult", () => {
  it("rejects an empty client pitch result", () => {
    expect(() => buildClientTranscriptionResult([])).toThrow(
      "Client pitch detection returned no notes",
    );
  });

  it("builds the client pYIN transcription contract from raw notes", () => {
    const result = buildClientTranscriptionResult(rawNotes);
    const selectedMelody = result.melodies[result.selectedMelodyKind];

    expect(result.provider).toBe("client_pyin");
    expect(result.rawNotes).toEqual(rawNotes);
    expect(result.warnings).toEqual([
      "Transcribed using browser-side pitch detection (degraded quality)",
    ]);
    expect(result.diagnostics).toEqual({
      duration: 1.75,
      snr: null,
      voicedRatio: null,
    });

    expect(result.melodies).toEqual({
      intent: expect.objectContaining({ notes: expect.any(Array) }),
      corrected: expect.objectContaining({ notes: expect.any(Array) }),
      musical: expect.objectContaining({ notes: expect.any(Array) }),
    });
    expect(result.cleanMelody).toBe(result.melodies.corrected);
    expect(["intent", "corrected", "musical"]).toContain(
      result.selectedMelodyKind,
    );
    expect(selectedMelody).toBeDefined();

    for (const melody of [result.cleanMelody, selectedMelody]) {
      expect(melody).toEqual({
        notes: expect.any(Array),
        key: expect.any(String),
        scale: expect.any(String),
        bpm: expect.any(Number),
        duration: expect.any(Number),
        contour: expect.any(String),
      });
    }
  });
});
