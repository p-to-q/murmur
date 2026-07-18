import { describe, expect, it } from "bun:test";

import { hashMusicJobRequest, MUSIC_OPERATION_ID_PATTERN } from "./music-job-contract";

describe("music job contract", () => {
  it("hashes semantically identical melody JSON identically", () => {
    const first = hashMusicJobRequest({
      prompt: "warm piano",
      duration: 10,
      styleMix: 0,
      melody: '{"notes":[{"pitch":60}]}',
      humDigest: null,
    });
    const second = hashMusicJobRequest({
      prompt: "warm piano",
      duration: 10,
      styleMix: 0,
      melody: '{ "notes": [ { "pitch": 60 } ] }',
      humDigest: null,
    });
    expect(first).toBe(second);
  });

  it("changes when a billed operation changes its content", () => {
    const base = { prompt: "warm piano", duration: 10, styleMix: 0, melody: "", humDigest: null };
    expect(hashMusicJobRequest(base)).not.toBe(hashMusicJobRequest({ ...base, prompt: "bright piano" }));
  });

  it("accepts only bounded URL-safe operation ids", () => {
    expect(MUSIC_OPERATION_ID_PATTERN.test("clip_abcdef123456")).toBe(true);
    expect(MUSIC_OPERATION_ID_PATTERN.test("bad id")).toBe(false);
    expect(MUSIC_OPERATION_ID_PATTERN.test("short")).toBe(false);
  });
});
