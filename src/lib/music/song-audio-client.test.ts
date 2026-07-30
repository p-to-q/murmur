import { describe, expect, it } from "bun:test";

import { resolveClientSongAudioUrl } from "./song-audio-client";

describe("client song audio source", () => {
  it("prefers the controlled delivery URL", () => {
    expect(resolveClientSongAudioUrl({
      audioUrl: "/api/songs/song-1/audio",
      mp3DataUrl: "data:audio/mpeg;base64,old",
      mp3Url: "https://old.example/audio.mp3",
    })).toBe("/api/songs/song-1/audio");
  });

  it("keeps legacy payloads playable during migration", () => {
    expect(resolveClientSongAudioUrl({ mp3DataUrl: "data:audio/mpeg;base64,old" }))
      .toBe("data:audio/mpeg;base64,old");
  });
});
