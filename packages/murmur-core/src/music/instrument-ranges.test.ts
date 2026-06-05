import { describe, expect, it } from "bun:test";
import { clampPitchToInstrument } from "./instrument-ranges";

const sourceNotes = [
  { pitch: 24, start: 0, duration: 0.5, velocity: 90, confidence: 0.8 },
  { pitch: 36, start: 0.5, duration: 0.5, velocity: 92, confidence: 0.8 },
  { pitch: 48, start: 1, duration: 0.5, velocity: 94, confidence: 0.8 },
];

describe("clampPitchToInstrument", () => {
  it("keeps notes inside the target melody range", () => {
    const clamped = clampPitchToInstrument(sourceNotes, "bell");
    expect(clamped.every((note) => note.pitch >= 67 && note.pitch <= 96)).toBe(true);
  });

  it("rejects bass instruments as melody carriers", () => {
    expect(() => clampPitchToInstrument(sourceNotes, "sub_bass")).toThrow(
      "Instrument sub_bass is not a melody carrier",
    );
  });
});
