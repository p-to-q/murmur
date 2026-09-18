import { describe, expect, it } from "bun:test";

import {
  detectAudioFilePrefix,
  detectAudioFileType,
  MAX_SONG_AUDIO_BYTES,
} from "./file-signature";

describe("detectAudioFileType", () => {
  it("recognizes complete MPEG frames with or without a valid ID3 tag", () => {
    const frame = mp3Frame();
    expect(detectAudioFileType(frame)).toBe("mp3");
    expect(detectAudioFileType(concat(
      new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]),
      frame,
    ))).toBe("mp3");
  });

  it("rejects truncated ID3 tags and incomplete or reserved MPEG frames", () => {
    expect(detectAudioFileType(new TextEncoder().encode("ID3audio"))).toBeNull();
    expect(detectAudioFileType(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBeNull();
    expect(detectAudioFileType(new Uint8Array([0xff, 0xfb, 0xf0, 0x64, 0, 0]))).toBeNull();
  });

  it("recognizes a structured RIFF/WAVE and rejects truncated containers", () => {
    expect(detectAudioFileType(wavFile())).toBe("wav");
    expect(detectAudioFileType(concat(wavFile(), new Uint8Array([0])))).toBeNull();
    expect(detectAudioFileType(new TextEncoder().encode("RIFF0000WAVEdata"))).toBeNull();
    expect(detectAudioFileType(new TextEncoder().encode("upstream error"))).toBeNull();
  });

  it("rejects empty and oversized payloads", () => {
    expect(detectAudioFileType(new Uint8Array())).toBeNull();
    expect(detectAudioFileType(new Uint8Array(MAX_SONG_AUDIO_BYTES + 1))).toBeNull();
  });
});

describe("detectAudioFilePrefix", () => {
  it("recognizes a partial WAV range without weakening whole-file validation", () => {
    const prefix = wavPrefix(4_096, 1_900_000);

    expect(detectAudioFilePrefix(prefix)).toBe("wav");
    expect(detectAudioFileType(prefix)).toBeNull();
  });

  it("recognizes complete MP3 frames in a leading range", () => {
    expect(detectAudioFilePrefix(concat(mp3Frame(), mp3Frame()))).toBe("mp3");
  });

  it("rejects malformed, impossible, and oversized WAV prefixes", () => {
    expect(detectAudioFilePrefix(new TextEncoder().encode("RIFF0000WAVEdata")))
      .toBeNull();
    expect(detectAudioFilePrefix(wavPrefix(64, 32))).toBeNull();
    expect(detectAudioFilePrefix(wavPrefix(64, MAX_SONG_AUDIO_BYTES + 1)))
      .toBeNull();
  });
});

function mp3Frame(): Uint8Array {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return frame;
}

function wavFile(): Uint8Array {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, 2, true);
  return bytes;
}

function wavPrefix(prefixSize: number, declaredFileSize: number): Uint8Array {
  const bytes = new Uint8Array(prefixSize);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, declaredFileSize - 8, true);
  writeAscii(bytes, 8, "WAVE");
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  bytes.set(new TextEncoder().encode(value), offset);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
