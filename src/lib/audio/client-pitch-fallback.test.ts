import { describe, expect, it } from "bun:test";
import { __testing } from "./client-pitch-fallback";

describe("client pitch fallback helpers", () => {
  it("mixes multi-channel audio into a stable mono buffer", () => {
    const left = new Float32Array([1, 0.5, -1]);
    const right = new Float32Array([-1, 0.5, 1]);
    const buffer = {
      length: left.length,
      numberOfChannels: 2,
      getChannelData: (channel: number) => (channel === 0 ? left : right),
    } as AudioBuffer;

    expect(Array.from(__testing.mixToMono(buffer))).toEqual([0, 0.5, 0]);
  });

  it("filters unvoiced and out-of-range frames", () => {
    const frames = __testing.buildFrames(
      new Float32Array([79, 80, 220, 800, 801]),
      new Float32Array([0.9, 0.31, 0.31, 0.31, 0.9]),
      44100,
    );

    expect(frames.map((frame) => frame.voiced)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(frames[2]!.frequency).toBe(220);
    expect(frames[2]!.confidence).toBeCloseTo(0.31, 6);
  });

  it("turns sustained voiced frames into notes and drops short blips", () => {
    const voicedFrames = Array.from({ length: 12 }, (_, index) => ({
      time: index * (256 / 44100),
      frequency: 440,
      confidence: 0.8,
      voiced: true,
    }));
    const shortBlip = Array.from({ length: 3 }, (_, index) => ({
      time: (13 + index) * (256 / 44100),
      frequency: 660,
      confidence: 0.9,
      voiced: true,
    }));

    const notes = __testing.framesToNotes([
      ...voicedFrames,
      { time: 12 * (256 / 44100), frequency: 0, confidence: 0, voiced: false },
      ...shortBlip,
      { time: 16 * (256 / 44100), frequency: 0, confidence: 0, voiced: false },
    ], 44100);

    expect(notes).toHaveLength(1);
    expect(notes[0]!.pitch).toBe(69);
    expect(notes[0]!.start).toBe(0);
    expect(notes[0]!.velocity).toBeCloseTo(0.72, 6);
    expect(notes[0]!.confidence).toBeCloseTo(0.8, 6);
    expect(notes[0]!.duration).toBeCloseTo(12 * (256 / 44100), 6);
  });

  it("merges adjacent same-pitch notes across a brief unvoiced gap", () => {
    const hop = 256 / 44100;
    const frames = [
      ...Array.from({ length: 12 }, (_, index) => ({
        time: index * hop,
        frequency: 440,
        confidence: 0.7,
        voiced: true,
      })),
      { time: 12 * hop, frequency: 0, confidence: 0, voiced: false },
      ...Array.from({ length: 12 }, (_, index) => ({
        time: (13 + index) * hop,
        frequency: 441,
        confidence: 0.8,
        voiced: true,
      })),
      { time: 25 * hop, frequency: 0, confidence: 0, voiced: false },
    ];

    const notes = __testing.framesToNotes(frames, 44100);

    expect(notes).toHaveLength(1);
    expect(notes[0]!.pitch).toBe(69);
    expect(notes[0]!.duration).toBeCloseTo(25 * hop, 6);
    expect(notes[0]!.confidence).toBeCloseTo(0.8, 6);
  });
});
