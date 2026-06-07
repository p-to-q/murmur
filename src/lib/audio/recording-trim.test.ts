import { describe, expect, it } from "bun:test";
import { encodePcm16Wav, findVoicedSampleRange } from "./recording-trim";

describe("recording trim helpers", () => {
  it("finds voiced samples and keeps padding around the take", () => {
    const sampleRate = 1000;
    const samples = new Float32Array(3000);
    samples.fill(0.05, 1000, 1800);

    const range = findVoicedSampleRange(samples, sampleRate, {
      thresholdRms: 0.01,
      windowMs: 20,
      paddingMs: 420,
      minDurationMs: 300,
    });

    expect(range).toEqual({ start: 580, end: 2220 });
  });

  it("captures softer openings that would otherwise be clipped away", () => {
    const sampleRate = 1000;
    const samples = new Float32Array(2200);
    samples.fill(0.0105, 820, 960);
    samples.fill(0.032, 960, 1500);

    const range = findVoicedSampleRange(samples, sampleRate);

    expect(range).toEqual({ start: 400, end: 1920 });
  });

  it("returns null when the recording has no stable voiced window", () => {
    const samples = new Float32Array(1000);
    samples.fill(0.002);

    expect(findVoicedSampleRange(samples, 1000)).toBeNull();
  });

  it("encodes mono PCM as a WAV blob", async () => {
    const wav = encodePcm16Wav(new Float32Array([0, 0.5, -0.5]), 22050);
    const bytes = new Uint8Array(await wav.arrayBuffer());

    expect(wav.type).toBe("audio/wav");
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
    expect(String.fromCharCode(...bytes.slice(36, 40))).toBe("data");
    expect(bytes.length).toBe(50);
  });
});
