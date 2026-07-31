import { describe, expect, it } from "bun:test";
import { analyzePcm16Wav } from "./music-output-quality";

function wav(samples: number[], sampleRate = 16_000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  }
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

function tone(seconds = 1): Uint8Array {
  return wav(Array.from({ length: 16_000 * seconds }, (_, index) =>
    Math.round(Math.sin(index / 8) * 8_000),
  ));
}

function sineSamples(seconds: number, amplitude = 0.3): number[] {
  return Array.from({ length: Math.round(16_000 * seconds) }, (_, index) =>
    Math.round(Math.sin(2 * Math.PI * 440 * index / 16_000) * amplitude * 32767),
  );
}

describe("music delivery quality gate", () => {
  it("accepts valid active PCM audio", () => {
    expect(analyzePcm16Wav(tone(), 1).passed).toBe(true);
  });

  it("rejects silence and corrupt payloads", () => {
    expect(analyzePcm16Wav(wav(new Array(16_000).fill(0)), 1).failures).toContain("near_silence");
    expect(analyzePcm16Wav(new Uint8Array([1, 2, 3]), 1).failures).toContain("invalid_wav");
  });

  it("accepts bytes after the declared RIFF payload", () => {
    const audio = tone();
    const withTrailingBytes = new Uint8Array(audio.byteLength + 5);
    withTrailingBytes.set(audio);
    withTrailingBytes.set([1, 2, 3, 4, 5], audio.byteLength);

    expect(analyzePcm16Wav(withTrailingBytes, 1).passed).toBe(true);
  });

  it("rejects RIFF sizes outside the physical file or data payload", () => {
    const beyondFile = tone();
    new DataView(beyondFile.buffer).setUint32(4, beyondFile.byteLength, true);
    expect(analyzePcm16Wav(beyondFile, 1).failures).toContain("invalid_wav_structure");

    const beforeDataEnd = tone();
    new DataView(beforeDataEnd.buffer).setUint32(4, beforeDataEnd.byteLength - 9, true);
    expect(analyzePcm16Wav(beforeDataEnd, 1).failures).toContain("invalid_wav_structure");
  });

  it("rejects low average level and peak-dominated audio", () => {
    const low = analyzePcm16Wav(wav(sineSamples(2, 500 / 32767)), 2);
    expect(low.failures).toEqual(["low_average_level"]);

    const spiky = sineSamples(2, 0.05);
    spiky[Math.floor(spiky.length / 2)] = Math.round(0.95 * 32767);
    const spikeResult = analyzePcm16Wav(wav(spiky), 2);
    expect(spikeResult.failures).toContain("excessive_crest_factor");
  });

  it("rejects opening fragments but permits a short musical pause", () => {
    const fragment = [...sineSamples(0.3), ...new Array(Math.round(1.7 * 16_000)).fill(0)];
    const fragmentResult = analyzePcm16Wav(wav(fragment), 2);
    expect(fragmentResult.failures).toContain("excessive_quiet_windows");
    expect(fragmentResult.failures).toContain("prolonged_silence");

    const pause = sineSamples(2);
    pause.fill(0, Math.round(0.8 * 16_000), Math.round(1.1 * 16_000));
    const pauseResult = analyzePcm16Wav(wav(pause), 2);
    expect(pauseResult.passed).toBe(true);
    expect(pauseResult.metrics.longestQuietRunSeconds).toBe(0.3);
  });

});
