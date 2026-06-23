import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";

let nextSong: Record<string, unknown> | null = null;
let getSongError: unknown = null;
let nextFallbackSong: Record<string, unknown> | null = null;
const getSongByShareCodeMock = mock(async () => {
  if (getSongError) throw getSongError;
  return nextSong;
});
const getLocalSongByShareCodeFallbackMock = mock(() => nextFallbackSong);

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

mock.module("@/lib/db/queries/local-song-fallback", () => ({
  getLocalSongByShareCodeFallback: getLocalSongByShareCodeFallbackMock,
}));

const { GET } = await import("./route");

function request(): NextRequest {
  return new Request("https://murmur.example/api/public/songs/abc234defg", {
    headers: {
      "x-request-id": "req_public_song",
      "x-real-ip": "203.0.113.9",
    },
  }) as unknown as NextRequest;
}

function ctx(shareCode = "abc234defg") {
  return { params: Promise.resolve({ shareCode }) };
}

beforeEach(async () => {
  resetCachedRateLimitStore();
  await getRateLimitStore().resetAll();
  nextSong = {
    id: "song_1",
    userId: "usr_owner",
    title: "Shared Song",
    vibe: "soft",
    vibeEn: "soft",
    bpm: 82,
    keySignature: "C",
    scaleType: "major",
    duration: 12,
    sourceMelodyKind: "corrected",
    editCount: 0,
    editDepth: "fresh",
    visibility: "unlisted",
    shareCode: "abc234defg",
    mp3DataUrl: "data:audio/mpeg;base64,abc",
    visualConfig: {
      preset: "warm_particles",
      gradient: "linear-gradient(135deg, #FF8A5C, #FF5924)",
      particleDensity: 0.5,
      pulseSource: "melody",
    },
    tags: ["soft"],
    createdAt: new Date("2026-06-20T00:00:00.000Z"),
    updatedAt: new Date("2026-06-20T00:00:00.000Z"),
  };
  getSongError = null;
  nextFallbackSong = null;
  getSongByShareCodeMock.mockClear();
  getLocalSongByShareCodeFallbackMock.mockClear();
});

describe("GET /api/public/songs/[shareCode]", () => {
  it("returns a minimal public playback payload for unlisted songs", async () => {
    const response = await GET(request(), ctx());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json() as Record<string, unknown>;
    expect(body.title).toBe("Shared Song");
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("scaleType");
    expect(body).not.toHaveProperty("sourceMelodyKind");
    expect(body).not.toHaveProperty("editCount");
    expect(body).not.toHaveProperty("editDepth");
    expect(body).not.toHaveProperty("arrangementState");
  });

  it("allows public songs to use shared cache without noindex", async () => {
    nextSong = { ...nextSong, visibility: "public" };

    const response = await GET(request(), ctx());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300");
  });

  it("returns 404 with noindex for historical shares without audio", async () => {
    nextSong = {
      ...nextSong,
      visibility: "public",
      mp3DataUrl: null,
      mp3Url: null,
    };

    const response = await GET(request(), ctx());

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });

  it("returns 404 with noindex for no-audio local fallback shares", async () => {
    getSongError = new Error("db unavailable");
    nextFallbackSong = {
      ...nextSong,
      visibility: "public",
      mp3DataUrl: null,
      mp3Url: null,
    };

    const response = await GET(request(), ctx());

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });

  it("rejects malformed share codes before querying", async () => {
    const response = await GET(request(), ctx("bad-code"));

    expect(response.status).toBe(400);
    expect(getSongByShareCodeMock).not.toHaveBeenCalled();
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("validation_error");
  });

  it("returns 404 with noindex after a share code has been revoked", async () => {
    nextSong = null;

    const response = await GET(request(), ctx("abc234defg"));

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });

  it("serves demo songs through the same public contract", async () => {
    const response = await GET(request(), ctx("demo-1"));

    expect(response.status).toBe(200);
    expect(getSongByShareCodeMock).not.toHaveBeenCalled();
    const body = await response.json() as Record<string, unknown>;
    expect(body.shareCode).toBe("demo-1");
    expect(body.mp3Url).toBe("/demo/weightless-dnb.mp3");
  });
});
