import { beforeEach, describe, expect, it, mock } from "bun:test";

let nextSong: {
  visibility: "private" | "unlisted" | "public";
  mp3DataUrl?: string | null;
  mp3Url?: string | null;
} | null = null;
let getSongError: unknown = null;
const getSongByShareCodeMock = mock(async () => {
  if (getSongError) throw getSongError;
  return nextSong;
});

mock.module("@/lib/db/queries/songs", () => ({
  createSong: mock(async () => null),
  createSongWithSpend: mock(async () => null),
  deleteSongForUser: mock(async () => false),
  getPublicSongSummaries: mock(async () => []),
  getSongByIdForCreateConflict: mock(async () => null),
  getSongByIdForUser: mock(async () => null),
  getSongByShareCode: getSongByShareCodeMock,
  getSongSummariesByUser: mock(async () => []),
  publishSongShareForUser: mock(async () => null),
  revokeSongShareForUser: mock(async () => null),
  updateSongForUser: mock(async () => null),
}));

const { generateMetadata } = await import("./page");
const {
  createLocalSongFallback,
  resetLocalSongFallbackForTests,
} = await import("@/lib/db/queries/local-song-fallback");

function props(shareCode: string) {
  return { params: Promise.resolve({ shareCode }) };
}

beforeEach(() => {
  nextSong = null;
  getSongError = null;
  getSongByShareCodeMock.mockClear();
  resetLocalSongFallbackForTests();
});

describe("generateMetadata for public song share pages", () => {
  it("marks unlisted share pages noindex", async () => {
    nextSong = { visibility: "unlisted", mp3DataUrl: "data:audio/mpeg;base64,abc" };

    const metadata = await generateMetadata(props("abc234defg"));

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates?.canonical).toBe("/s/abc234defg");
  });

  it("allows public share pages to be indexed", async () => {
    nextSong = { visibility: "public", mp3DataUrl: "data:audio/mpeg;base64,abc" };

    const metadata = await generateMetadata(props("abc234defg"));

    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("marks no-audio public share pages noindex", async () => {
    nextSong = { visibility: "public", mp3DataUrl: null, mp3Url: null };

    const metadata = await generateMetadata(props("abc234defg"));

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("marks missing share pages noindex", async () => {
    nextSong = null;

    const metadata = await generateMetadata(props("abc234defg"));

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("uses the local fallback for metadata when the database is unavailable", async () => {
    getSongError = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    createLocalSongFallback({
      id: "song_metadata_fallback",
      userId: "guest",
      title: "Metadata Fallback",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      visibility: "public",
      shareCode: "abc234defg",
      mp3DataUrl: "data:audio/mpeg;base64,abc",
      visualConfig: {
        preset: "soft_gradient",
        gradient: "linear-gradient(135deg, #f6d365, #fda085)",
        particleDensity: 0.4,
        pulseSource: "energy",
      },
      arrangementState: {
        melody: { enabled: true, intensity: 0.8, originalPattern: "60", currentPattern: "60", instrument: "piano", versionHistory: [] },
        chords: { enabled: true, intensity: 0.6, originalPattern: "gen:sunset", currentPattern: "gen:sunset", instrument: "felt_piano", versionHistory: [] },
        strings: { enabled: false, intensity: 0.3, originalPattern: "pad", currentPattern: "pad", instrument: "string_ensemble", versionHistory: [] },
        drums: { enabled: false, intensity: 0.2, originalPattern: "none", currentPattern: "none", instrument: "brush_kit", versionHistory: [] },
        bass: { enabled: true, intensity: 0.4, originalPattern: "root", currentPattern: "root", instrument: "upright_bass", versionHistory: [] },
        texture: { enabled: true, intensity: 0.2, originalPattern: "air", currentPattern: "air", instrument: "vinyl_noise", versionHistory: [] },
      },
      tags: [],
    });

    const metadata = await generateMetadata(props("abc234defg"));

    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("marks demo share pages noindex", async () => {
    const metadata = await generateMetadata(props("demo-1"));

    expect(getSongByShareCodeMock).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
