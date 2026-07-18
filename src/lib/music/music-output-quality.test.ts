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

describe("music delivery quality gate", () => {
  it("accepts valid active PCM audio", () => {
    expect(analyzePcm16Wav(tone(), 1).passed).toBe(true);
  });

  it("rejects silence and corrupt payloads", () => {
    expect(analyzePcm16Wav(wav(new Array(16_000).fill(0)), 1).failures).toContain("near_silence");
    expect(analyzePcm16Wav(new Uint8Array([1, 2, 3]), 1).failures).toContain("invalid_wav");
  });

});
