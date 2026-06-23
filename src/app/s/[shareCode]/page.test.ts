import { beforeEach, describe, expect, it, mock } from "bun:test";

let nextSong: {
  visibility: "private" | "unlisted" | "public";
  mp3DataUrl?: string | null;
  mp3Url?: string | null;
} | null = null;
const getSongByShareCodeMock = mock(async () => nextSong);

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

function props(shareCode: string) {
  return { params: Promise.resolve({ shareCode }) };
}

beforeEach(() => {
  nextSong = null;
  getSongByShareCodeMock.mockClear();
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

  it("marks demo share pages noindex", async () => {
    const metadata = await generateMetadata(props("demo-1"));

    expect(getSongByShareCodeMock).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
