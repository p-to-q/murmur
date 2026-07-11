import { describe, expect, it } from "bun:test";

import { polishMelody } from "@/modules/music/melody-polisher";
import { transcribeWithStainer } from "@/modules/stainer/transcribe";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import { assembleSong } from "./assemble-song";
import type { MelodyNote } from "@/modules/shared/types";
import {
  INSTRUMENT_RANGES,
  type InstrumentId,
} from "@murmur/core/music/instrument-ranges";

const KNOWN_HUM: MelodyNote[] = [
  { pitch: 60, start: 0, duration: 0.42, velocity: 0.68, confidence: 0.93 },
  { pitch: 62, start: 0.5, duration: 0.44, velocity: 0.7, confidence: 0.92 },
  { pitch: 64, start: 1, duration: 0.42, velocity: 0.69, confidence: 0.91 },
  { pitch: 67, start: 1.5, duration: 0.62, velocity: 0.72, confidence: 0.94 },
  { pitch: 65, start: 2.2, duration: 0.44, velocity: 0.66, confidence: 0.9 },
  { pitch: 64, start: 2.7, duration: 0.44, velocity: 0.65, confidence: 0.9 },
  { pitch: 60, start: 3.2, duration: 0.9, velocity: 0.7, confidence: 0.95 },
];

describe("music smoke path", () => {
  it("transcribes the explicit demo fixture and assembles a playable song", async () => {
    const transcription = await transcribeWithStainer({});
    const versions = generateVibeVersions(transcription.cleanMelody, {
      sourceMelodyKind: transcription.selectedMelodyKind,
    });
    const assembled = assembleSong(versions[0]!);

    expect(transcription.provider).toBe("fixture");
    expect(transcription.cleanMelody.notes.length).toBeGreaterThan(0);
    expect(versions).toHaveLength(3);
    expect(versions[0]?.sourceMelodyKind).toBe(transcription.selectedMelodyKind);
    expect(assembled.totalDuration).toBeGreaterThan(0);
    expect(assembled.chords.length).toBeGreaterThan(0);
  });

  it("polishes a known hum, generates typed tracks, and assembles output", () => {
    const melody = polishMelody(KNOWN_HUM);
    const versions = generateVibeVersions(melody, {
      sourceMelodyKind: "corrected",
    });

    expect(versions).toHaveLength(3);
    const version = versions[0]!;

    expect(version.melody.notes.length).toBeGreaterThan(0);
    for (const generatedVersion of versions) {
      const instrument = generatedVersion.arrangementState.melody.instrument as InstrumentId;
      const range = INSTRUMENT_RANGES[instrument];
      expect(range?.canCarryMelody).toBe(true);
      for (const note of generatedVersion.melody.notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(range.lowMidi);
        expect(note.pitch).toBeLessThanOrEqual(range.highMidi);
      }
    }
    expect(version.arrangementState.melody.melodyPitchSequence).toEqual(
      version.melody.notes.map((note) => note.pitch),
    );
    expect(version.sourceMelodyKind).toBe("corrected");
    expect(version.arrangementState.chords.chordsTag).toBeTruthy();
    expect(version.arrangementState.bass.bassPattern).toBeTruthy();
    expect(version.arrangementState.drums.drumsPattern).toBeTruthy();
    expect(version.arrangementState.texture.texturePreset).toBeTruthy();

    const assembled = assembleSong(version);
    expect(assembled.totalDuration).toBeGreaterThanOrEqual(melody.duration);
    expect(assembled.chords.length).toBeGreaterThan(0);
    expect(version.arrangementState.chords.chordsTag).toBeDefined();
    expect(assembled.vibeId).toBe(version.arrangementState.chords.chordsTag!);
    expect(assembleSong(version)).toEqual(assembled);
  });
});
