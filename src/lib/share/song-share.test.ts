import { describe, expect, it } from "bun:test";
import {
  buildSongShareUrl,
  createSongShareCode,
  hasSongShareAudio,
  normalizeSongShareCode,
  normalizeSongShareVisibility,
} from "./song-share";

describe("song share helpers", () => {
  it("creates normalized share codes with an unambiguous alphabet", () => {
    const code = createSongShareCode();
    expect(code).toMatch(/^[23456789abcdefghijkmnopqrstuvwxyz]{10}$/);
    expect(normalizeSongShareCode(code.toUpperCase())).toBe(code);
  });

  it("rejects malformed share codes", () => {
    expect(normalizeSongShareCode("demo-1")).toBeNull();
    expect(normalizeSongShareCode("abc")).toBeNull();
    expect(normalizeSongShareCode("0000000000")).toBeNull();
  });

  it("defaults sharing to unlisted visibility", () => {
    expect(normalizeSongShareVisibility(undefined)).toBe("unlisted");
    expect(normalizeSongShareVisibility("private")).toBe("unlisted");
    expect(normalizeSongShareVisibility("public")).toBe("public");
  });

  it("builds canonical public song URLs", () => {
    expect(buildSongShareUrl("https://murmur.example/", "abc234defg"))
      .toBe("https://murmur.example/s/abc234defg");
  });

  it("requires a non-empty audio URL before a song can be shared", () => {
    expect(hasSongShareAudio({ mp3DataUrl: "data:audio/mpeg;base64,abc" })).toBe(true);
    expect(hasSongShareAudio({ mp3Url: "/songs/demo.mp3" })).toBe(true);
    expect(hasSongShareAudio({ mp3DataUrl: " ", mp3Url: "" })).toBe(false);
    expect(hasSongShareAudio({})).toBe(false);
  });
});
