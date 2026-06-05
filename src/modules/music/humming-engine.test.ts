import { describe, expect, it } from "bun:test";
import type { CleanMelody, MelodyNote, TranscriptionContour } from "@/modules/shared/types";
import {
  applyRepairBiasToMelodyKind,
  buildTranscriptionMelodies,
  chooseGenerationMelodyKind,
  selectGenerationMelody,
} from "./humming-engine";

function melody(
  notes: MelodyNote[],
  overrides: Partial<CleanMelody> = {},
): CleanMelody {
  return {
    notes,
    key: "C",
    scale: "major",
    bpm: 120,
    duration: Math.max(...notes.map((note) => note.start + note.duration)),
    contour: "rising",
    ...overrides,
  };
}

describe("humming-engine musical layer", () => {
  function contour(
    input: Partial<TranscriptionContour> & Pick<TranscriptionContour, "timestamps" | "pitchHz" | "confidence" | "voiced">,
  ): TranscriptionContour {
    return {
      hopSeconds: 0.01,
      ...input,
    };
  }

  it("compacts rushed ornamental bursts into a smoother musical phrase", () => {
    const corrected = melody([
      { pitch: 60, start: 0, duration: 0.22, velocity: 0.72, confidence: 0.83 },
      { pitch: 61, start: 0.24, duration: 0.1, velocity: 0.67, confidence: 0.58 },
      { pitch: 62, start: 0.36, duration: 0.14, velocity: 0.7, confidence: 0.61 },
      { pitch: 64, start: 0.52, duration: 0.46, velocity: 0.75, confidence: 0.86 },
    ]);

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected);

    expect(melodies.corrected.notes).toHaveLength(4);
    expect(melodies.musical.notes.length).toBeLessThan(melodies.corrected.notes.length);
    expect(melodies.musical.duration).toBeGreaterThanOrEqual(melodies.corrected.duration);
  });

  it("nudges phrase endings toward a more stable cadence target", () => {
    const corrected = melody(
      [
        { pitch: 67, start: 0, duration: 0.4, velocity: 0.72, confidence: 0.88 },
        { pitch: 69, start: 0.45, duration: 0.35, velocity: 0.72, confidence: 0.86 },
        { pitch: 71, start: 0.85, duration: 0.32, velocity: 0.7, confidence: 0.79 },
      ],
      {
        contour: "rising",
      },
    );

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected);
    const finalCorrected = melodies.corrected.notes.at(-1)?.pitch;
    const finalMusical = melodies.musical.notes.at(-1)?.pitch;

    expect(finalCorrected).toBe(71);
    expect(finalMusical).toBe(72);
  });

  it("keeps cadence holds subtle instead of stretching phrase endings too far", () => {
    const corrected = melody(
      [
        { pitch: 67, start: 0, duration: 0.22, velocity: 0.72, confidence: 0.88 },
        { pitch: 69, start: 0.3, duration: 0.2, velocity: 0.72, confidence: 0.86 },
        { pitch: 71, start: 0.56, duration: 0.18, velocity: 0.7, confidence: 0.85 },
      ],
      {
        bpm: 120,
        contour: "rising",
      },
    );

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected);
    const finalMusical = melodies.musical.notes.at(-1);

    expect(finalMusical?.duration).toBeGreaterThan(0.18);
    expect(finalMusical?.duration).toBeLessThanOrEqual(0.27);
  });

  it("relocates short weak notes toward a cleaner beat position", () => {
    const corrected = melody(
      [
        { pitch: 60, start: 0, duration: 0.34, velocity: 0.72, confidence: 0.86 },
        { pitch: 62, start: 0.31, duration: 0.12, velocity: 0.66, confidence: 0.62 },
        { pitch: 64, start: 0.56, duration: 0.42, velocity: 0.74, confidence: 0.84 },
      ],
      {
        bpm: 120,
      },
    );

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected);
    const correctedMiddle = melodies.corrected.notes[1]?.start;
    const musicalMiddle = melodies.musical.notes[1]?.start;

    expect(correctedMiddle).toBe(0.31);
    expect(musicalMiddle).toBeLessThan(correctedMiddle!);
    expect(Math.abs((musicalMiddle ?? 0) - 0.25)).toBeLessThan(0.02);
  });

  it("stabilizes urgent short-note phrases into more listenable durations", () => {
    const corrected = melody(
      [
        { pitch: 67, start: 0, duration: 0.14, velocity: 0.74, confidence: 0.84 },
        { pitch: 69, start: 0.18, duration: 0.16, velocity: 0.73, confidence: 0.85 },
        { pitch: 67, start: 0.4, duration: 0.18, velocity: 0.72, confidence: 0.82 },
        { pitch: 64, start: 0.62, duration: 0.12, velocity: 0.72, confidence: 0.81 },
        { pitch: 62, start: 0.84, duration: 0.2, velocity: 0.74, confidence: 0.86 },
      ],
      { bpm: 120 },
    );

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected);
    const correctedAvg =
      melodies.corrected.notes.slice(0, 4).reduce((sum, note) => sum + note.duration, 0) / 4;
    const musicalAvg =
      melodies.musical.notes.slice(0, 4).reduce((sum, note) => sum + note.duration, 0) / 4;

    expect(musicalAvg).toBeGreaterThan(correctedAvg);
    expect(melodies.musical.notes[0]?.duration).toBeGreaterThanOrEqual(0.14);
    expect(melodies.musical.notes[1]?.duration).toBeGreaterThanOrEqual(0.16);
    expect(melodies.musical.notes[3]?.duration).toBeGreaterThanOrEqual(0.12);
  });

  it("preserves timing but repairs pitch on rhythm-stable, pitch-weak takes", () => {
    const corrected = melody(
      [
        { pitch: 60, start: 0, duration: 0.48, velocity: 0.74, confidence: 0.84 },
        { pitch: 63, start: 0.5, duration: 0.46, velocity: 0.71, confidence: 0.61 },
        { pitch: 67, start: 1.0, duration: 0.5, velocity: 0.75, confidence: 0.86 },
        { pitch: 72, start: 1.5, duration: 0.64, velocity: 0.78, confidence: 0.82 },
      ],
      {
        bpm: 120,
        key: "C",
        scale: "major",
        contour: "rising",
      },
    );

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected);

    expect(melodies.musical.notes[1]?.start).toBeCloseTo(0.5, 6);
    expect(melodies.musical.notes[1]?.pitch).toBe(64);
    expect(melodies.corrected.notes[1]?.pitch).toBe(63);
  });

  it("stabilizes repeated hook notes before decorative tones", () => {
    const corrected = melody(
      [
        { pitch: 60, start: 0, duration: 0.5, velocity: 0.76, confidence: 0.9 },
        { pitch: 64, start: 0.5, duration: 0.5, velocity: 0.72, confidence: 0.88 },
        { pitch: 67, start: 1.0, duration: 0.5, velocity: 0.73, confidence: 0.87 },
        { pitch: 61, start: 1.5, duration: 0.48, velocity: 0.7, confidence: 0.62 },
        { pitch: 64, start: 2.0, duration: 0.5, velocity: 0.72, confidence: 0.88 },
        { pitch: 67, start: 2.5, duration: 0.6, velocity: 0.74, confidence: 0.86 },
      ],
      {
        bpm: 120,
        key: "C",
        scale: "major",
      },
    );

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected);

    expect(melodies.corrected.notes[3]?.pitch).toBe(61);
    expect(melodies.musical.notes[3]?.pitch).toBe(60);
  });

  it("prefers musical melody when input is fragmented and weak", () => {
    const melodies = buildTranscriptionMelodies([
      { pitch: 60, start: 0, duration: 0.12, velocity: 0.7, confidence: 0.58 },
      { pitch: 62, start: 0.18, duration: 0.14, velocity: 0.68, confidence: 0.61 },
      { pitch: 64, start: 0.36, duration: 0.12, velocity: 0.69, confidence: 0.6 },
      { pitch: 65, start: 0.54, duration: 0.14, velocity: 0.66, confidence: 0.59 },
      { pitch: 67, start: 0.72, duration: 0.12, velocity: 0.7, confidence: 0.62 },
      { pitch: 69, start: 0.9, duration: 0.14, velocity: 0.71, confidence: 0.6 },
    ]);

    expect(
      chooseGenerationMelodyKind({
        melodies,
        diagnostics: { duration: 1.04, snr: 8.5, voicedRatio: 0.54 },
      }),
    ).toBe("musical");
  });

  it("promotes musical melody when contour confidence and continuity are weak even if notes look passable", () => {
    const melodies = buildTranscriptionMelodies([
      { pitch: 60, start: 0, duration: 0.35, velocity: 0.7, confidence: 0.8 },
      { pitch: 62, start: 0.45, duration: 0.35, velocity: 0.68, confidence: 0.79 },
      { pitch: 64, start: 0.9, duration: 0.38, velocity: 0.71, confidence: 0.81 },
      { pitch: 65, start: 1.35, duration: 0.38, velocity: 0.69, confidence: 0.8 },
      { pitch: 67, start: 1.8, duration: 0.4, velocity: 0.73, confidence: 0.82 },
    ]);

    expect(
      chooseGenerationMelodyKind({
        melodies,
        diagnostics: { duration: 2.2, snr: 17, voicedRatio: 0.83 },
        contour: contour({
          timestamps: Array.from({ length: 18 }, (_, i) => i * 0.01),
          pitchHz: [
            261.63, 262.1, null, 293.66, 294.8, null, 329.63, 348.99, 329.63,
            null, 392.0, 415.3, 392.0, null, 440.0, 392.0, null, 392.0,
          ],
          confidence: [
            0.74, 0.71, 0.1, 0.69, 0.7, 0.08, 0.66, 0.64, 0.67,
            0.09, 0.7, 0.66, 0.68, 0.12, 0.69, 0.65, 0.1, 0.68,
          ],
          voiced: [
            true, true, false, true, true, false, true, true, true,
            false, true, true, true, false, true, true, false, true,
          ],
        }),
      }),
    ).toBe("musical");
  });

  it("promotes musical melody when acceptance diagnostics say the phrase still feels wrong", () => {
    const melodies = buildTranscriptionMelodies([
      { pitch: 60, start: 0.2, duration: 0.42, velocity: 0.74, confidence: 0.84 },
      { pitch: 62, start: 0.76, duration: 0.18, velocity: 0.71, confidence: 0.82 },
      { pitch: 64, start: 1.08, duration: 0.82, velocity: 0.75, confidence: 0.83 },
    ]);

    expect(
      chooseGenerationMelodyKind({
        melodies,
        diagnostics: {
          duration: 1.9,
          snr: 14.2,
          voicedRatio: 0.78,
          acceptanceScore: 0.47,
          musicFeelScore: 0.49,
          excessiveHoldRatio: 0.34,
          onsetFragmentation: 0.55,
          firstOnsetLag: 0.22,
        },
      }),
    ).toBe("musical");
  });

  it("tightens overheld interior notes when acceptance says the phrase is dragging", () => {
    const corrected = melody(
      [
        { pitch: 60, start: 0, duration: 0.34, velocity: 0.74, confidence: 0.88 },
        { pitch: 62, start: 0.42, duration: 0.88, velocity: 0.7, confidence: 0.69 },
        { pitch: 64, start: 1.38, duration: 0.34, velocity: 0.72, confidence: 0.84 },
        { pitch: 67, start: 1.82, duration: 0.28, velocity: 0.73, confidence: 0.86 },
      ],
      {
        bpm: 120,
        contour: "rising",
      },
    );

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected, {
      diagnostics: {
        duration: 2.1,
        snr: 15,
        voicedRatio: 0.82,
        acceptanceScore: 0.44,
        musicFeelScore: 0.46,
        excessiveHoldRatio: 0.38,
        onsetFragmentation: 0.44,
        firstOnsetLag: 0.04,
      },
    });

    expect(melodies.corrected.notes[1]?.duration).toBe(0.88);
    expect(melodies.musical.notes[1]?.duration).toBeLessThan(0.7);
    expect(melodies.musical.notes[1]?.duration).toBeGreaterThan(0.2);
  });

  it("aligns unstable interior notes to a cleaner rhythmic skeleton during repair", () => {
    const corrected = melody(
      [
        { pitch: 60, start: 0, duration: 0.31, velocity: 0.74, confidence: 0.88 },
        { pitch: 62, start: 0.47, duration: 0.29, velocity: 0.69, confidence: 0.67 },
        { pitch: 64, start: 0.99, duration: 0.33, velocity: 0.71, confidence: 0.68 },
        { pitch: 67, start: 1.46, duration: 0.58, velocity: 0.72, confidence: 0.7 },
      ],
      {
        bpm: 120,
        contour: "rising",
      },
    );

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected, {
      diagnostics: {
        duration: 2.04,
        snr: 13,
        voicedRatio: 0.8,
        acceptanceScore: 0.48,
        musicFeelScore: 0.5,
        excessiveHoldRatio: 0.3,
        interiorHoldRatio: 0.22,
        onsetFragmentation: 0.48,
        firstOnsetLag: 0.03,
      },
    });

    expect(melodies.musical.notes[1]?.start).toBeCloseTo(0.5, 1);
    expect(melodies.musical.notes[2]?.start).toBeCloseTo(1.0, 1);
    expect(melodies.musical.notes[1]?.duration).toBeLessThanOrEqual(0.29);
    expect(melodies.musical.notes[2]?.duration).toBeLessThanOrEqual(0.36);
  });

  it("forces the stronger repair branch on weak familiar-song timing shapes", () => {
    const corrected = melody(
      [
        { pitch: 60, start: 0.18, duration: 0.52, velocity: 0.72, confidence: 0.86 },
        { pitch: 62, start: 0.78, duration: 0.18, velocity: 0.69, confidence: 0.77 },
        { pitch: 64, start: 1.08, duration: 0.78, velocity: 0.71, confidence: 0.72 },
        { pitch: 60, start: 1.94, duration: 0.26, velocity: 0.72, confidence: 0.84 },
      ],
      {
        bpm: 118,
        contour: "wave",
      },
    );

    const melodies = buildTranscriptionMelodies(corrected.notes, corrected, {
      diagnostics: {
        duration: 2.2,
        snr: 13.8,
        voicedRatio: 0.79,
        acceptanceScore: 0.41,
        musicFeelScore: 0.45,
        excessiveHoldRatio: 0.35,
        onsetFragmentation: 0.58,
        firstOnsetLag: 0.19,
      },
    });

    expect(chooseGenerationMelodyKind({
      melodies,
      diagnostics: {
        duration: 2.2,
        snr: 13.8,
        voicedRatio: 0.79,
        acceptanceScore: 0.41,
        musicFeelScore: 0.45,
        excessiveHoldRatio: 0.35,
        onsetFragmentation: 0.58,
        firstOnsetLag: 0.19,
      },
    })).toBe("musical");
    expect(melodies.musical.notes[0]?.start).toBeLessThanOrEqual(0.18);
    expect(melodies.musical.notes[2]?.duration).toBeLessThan(0.78);
  });

  it("lets a strong pleasantness bias promote the musical layer", () => {
    const melodies = buildTranscriptionMelodies([
      { pitch: 60, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.8 },
      { pitch: 62, start: 0.5, duration: 0.4, velocity: 0.68, confidence: 0.82 },
      { pitch: 64, start: 1.0, duration: 0.45, velocity: 0.72, confidence: 0.84 },
    ]);

    expect(selectGenerationMelody({ melodies }, { repairBias: 0.8 }).kind).toBe("musical");
  });

  it("lets a strong fidelity bias favor intent when the take is stable enough", () => {
    const melodies = buildTranscriptionMelodies([
      { pitch: 60, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.84 },
      { pitch: 62, start: 0.5, duration: 0.42, velocity: 0.69, confidence: 0.86 },
      { pitch: 64, start: 1.0, duration: 0.48, velocity: 0.72, confidence: 0.88 },
    ]);

    expect(
      applyRepairBiasToMelodyKind("corrected", { melodies }, -0.8),
    ).toBe("intent");
  });

  it("does not force raw intent on unstable takes even with fidelity bias", () => {
    const melodies = buildTranscriptionMelodies([
      { pitch: 60, start: 0, duration: 0.12, velocity: 0.7, confidence: 0.58 },
      { pitch: 62, start: 0.18, duration: 0.14, velocity: 0.68, confidence: 0.61 },
      { pitch: 64, start: 0.36, duration: 0.12, velocity: 0.69, confidence: 0.6 },
      { pitch: 65, start: 0.54, duration: 0.14, velocity: 0.66, confidence: 0.59 },
      { pitch: 67, start: 0.72, duration: 0.12, velocity: 0.7, confidence: 0.62 },
      { pitch: 69, start: 0.9, duration: 0.14, velocity: 0.71, confidence: 0.6 },
    ]);

    expect(
      applyRepairBiasToMelodyKind(
        "musical",
        { melodies, diagnostics: { duration: 1.04, snr: 8.5, voicedRatio: 0.54 } },
        -0.9,
      ),
    ).toBe("corrected");
  });

  it("allows fidelity bias to choose intent when contour evidence is stable", () => {
    const melodies = buildTranscriptionMelodies([
      { pitch: 60, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.78 },
      { pitch: 62, start: 0.5, duration: 0.4, velocity: 0.68, confidence: 0.77 },
      { pitch: 64, start: 1.0, duration: 0.45, velocity: 0.72, confidence: 0.79 },
      { pitch: 65, start: 1.5, duration: 0.45, velocity: 0.71, confidence: 0.8 },
    ]);

    expect(
      applyRepairBiasToMelodyKind(
        "corrected",
        {
          melodies,
          diagnostics: { duration: 1.95, snr: 18, voicedRatio: 0.91 },
          contour: contour({
            timestamps: Array.from({ length: 20 }, (_, i) => i * 0.01),
            pitchHz: [
              261.63, 261.7, 261.6, 261.65, 293.66, 293.7, 293.6, 293.68, 329.63, 329.7,
              329.6, 329.66, 349.23, 349.2, 349.25, 349.22, 349.2, 349.24, 349.21, 349.22,
            ],
            confidence: Array.from({ length: 20 }, () => 0.9),
            voiced: Array.from({ length: 20 }, () => true),
          }),
        },
        -0.85,
      ),
    ).toBe("intent");
  });
});
