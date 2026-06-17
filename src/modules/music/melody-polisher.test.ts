import { describe, expect, it } from "bun:test";
import type { MelodyNote } from "@/modules/shared/types";
import { polishMelody } from "./melody-polisher";

function note(
  pitch: number,
  start: number,
  duration: number,
  confidence = 0.9,
): MelodyNote {
  return {
    pitch,
    start,
    duration,
    velocity: 0.72,
    confidence,
  };
}

describe("melody-polisher articulation", () => {
  it("keeps intentional repeated notes as separate attacks", () => {
    const polished = polishMelody([
      note(60, 0, 0.2, 0.9),
      note(60, 0.23, 0.2, 0.88),
      note(62, 0.52, 0.28, 0.9),
    ]);

    expect(polished.notes.map((melodyNote) => melodyNote.pitch)).toEqual([
      60,
      60,
      62,
    ]);
  });

  it("preserves close neighbor motion for glide-like syllables", () => {
    const polished = polishMelody([
      note(60, 0, 0.24, 0.9),
      note(61, 0.27, 0.22, 0.86),
      note(62, 0.55, 0.3, 0.9),
    ]);

    expect(polished.notes.map((melodyNote) => melodyNote.pitch)).toEqual([
      60,
      61,
      62,
    ]);
  });

  it("still absorbs weak same-pitch fragments", () => {
    const polished = polishMelody([
      note(60, 0, 0.28, 0.9),
      note(60, 0.285, 0.05, 0.5),
      note(62, 0.5, 0.28, 0.9),
    ]);

    expect(polished.notes).toHaveLength(2);
    expect(polished.notes.map((melodyNote) => melodyNote.pitch)).toEqual([
      60,
      62,
    ]);
  });

  it("removes weak embedded detours without cutting true passing notes", () => {
    const noisy = polishMelody([
      note(60, 0, 0.24, 0.9),
      note(65, 0.25, 0.07, 0.52),
      note(60, 0.33, 0.24, 0.88),
      note(62, 0.68, 0.28, 0.9),
    ]);
    const passing = polishMelody([
      note(60, 0, 0.2, 0.88),
      note(62, 0.22, 0.1, 0.64),
      note(64, 0.34, 0.22, 0.86),
      note(67, 0.68, 0.3, 0.9),
    ]);

    expect(noisy.notes.map((melodyNote) => melodyNote.pitch)).not.toContain(65);
    expect(passing.notes.map((melodyNote) => melodyNote.pitch)).toContain(62);
  });
});
