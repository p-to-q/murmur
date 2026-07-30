import { describe, expect, it } from "bun:test";

import { parseAudioDataUrl, privateSongAudioDeliveryEnabled } from "./song-audio";

describe("song audio persistence", () => {
  it("accepts matching MP3/WAV signatures and rejects mislabeled bytes", () => {
    const mp3 = `data:audio/mpeg;base64,${Buffer.from(mp3Frame()).toString("base64")}`;
    const wav = `data:audio/wav;base64,${Buffer.from(wavFile()).toString("base64")}`;
    const invalid = `data:audio/mpeg;base64,${Buffer.from("upstream error").toString("base64")}`;
    expect(parseAudioDataUrl(mp3)?.ext).toBe("mp3");
    expect(parseAudioDataUrl(wav)?.ext).toBe("wav");
    expect(parseAudioDataUrl(invalid)).toBeNull();
    expect(parseAudioDataUrl("data:audio/mpeg;base64,SUQzYXVkaW8=")).toBeNull();
    expect(parseAudioDataUrl("data:audio/mpeg;base64,abc")).toBeNull();
  });

  it("requires an explicit production cutover for private writes", () => {
    expect(privateSongAudioDeliveryEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(privateSongAudioDeliveryEnabled({
      NODE_ENV: "production",
      MURMUR_PRIVATE_SONG_AUDIO_DELIVERY: "1",
    })).toBe(true);
    expect(privateSongAudioDeliveryEnabled({ NODE_ENV: "test" })).toBe(true);
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
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, 2, true);
  return bytes;
}
