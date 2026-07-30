import { describe, expect, it } from "bun:test";

import { detectAudioFileType } from "./file-signature";

describe("detectAudioFileType", () => {
  it("recognizes ID3 and header-only MP3 files", () => {
    expect(detectAudioFileType(new TextEncoder().encode("ID3audio"))).toBe("mp3");
    expect(detectAudioFileType(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe("mp3");
  });

  it("recognizes RIFF/WAVE and rejects mislabeled bytes", () => {
    expect(detectAudioFileType(new TextEncoder().encode("RIFF0000WAVEdata"))).toBe("wav");
    expect(detectAudioFileType(new TextEncoder().encode("upstream error"))).toBeNull();
  });
});
