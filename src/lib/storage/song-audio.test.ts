import { describe, expect, it } from "bun:test";

import { parseAudioDataUrl, privateSongAudioDeliveryEnabled } from "./song-audio";

describe("song audio persistence", () => {
  it("accepts matching MP3/WAV signatures and rejects mislabeled bytes", () => {
    const mp3 = `data:audio/mpeg;base64,${Buffer.from("ID3audio").toString("base64")}`;
    const wav = `data:audio/wav;base64,${Buffer.from("RIFF0000WAVEdata").toString("base64")}`;
    const invalid = `data:audio/mpeg;base64,${Buffer.from("upstream error").toString("base64")}`;
    expect(parseAudioDataUrl(mp3)?.ext).toBe("mp3");
    expect(parseAudioDataUrl(wav)?.ext).toBe("wav");
    expect(parseAudioDataUrl(invalid)).toBeNull();
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
