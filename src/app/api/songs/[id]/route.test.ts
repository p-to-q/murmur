import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_owner", email: null, name: "Owner", avatarUrl: null },
  source: "session",
  sessionId: "sess_owner",
};

let nextSong: Record<string, unknown> | null = {
  id: "song_owner",
  userId: "usr_owner",
  title: "Owned Song",
};
let nextUpdatedSong: Record<string, unknown> | null = {
  id: "song_owner",
  userId: "usr_owner",
  title: "Renamed Song",
};
let nextDeleteResult = true;
let updateSongError: unknown = null;

const getSongByIdForUserMock = mock(async () => nextSong);
const getSongSummaryByIdForUserMock = mock(async () => nextSong);
const updateSongForUserMock = mock(async () => {
  if (updateSongError) throw updateSongError;
  return nextUpdatedSong;
});
const deleteSongForUserMock = mock(async () => nextDeleteResult);

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/songs", () => ({
  createSong: mock(async () => null),
  createSongWithSpend: mock(async () => null),
  deleteSong: mock(async () => false),
  deleteSongForUser: deleteSongForUserMock,
  getPublicSongByShareCode: mock(async () => null),
  getPublicSongSummaries: mock(async () => []),
  getSongById: mock(async () => null),
  getSongByIdForUser: getSongByIdForUserMock,
  getSongByShareCode: mock(async () => null),
  getSongShareMetaByShareCode: mock(async () => null),
  getSongSummariesByUser: mock(async () => []),
  getSongSummaryByIdForUser: getSongSummaryByIdForUserMock,
  publishSongShareForUser: mock(async () => null),
  revokeSongShareForUser: mock(async () => null),
  updateSong: mock(async () => null),
  updateSongForUser: updateSongForUserMock,
}));

const { DELETE, GET, PATCH } = await import("./route");
const {
  createLocalSongFallback,
  resetLocalSongFallbackForTests,
} = await import("@/lib/db/queries/local-song-fallback");

function request(
  method: string,
  body?: Record<string, unknown>,
  url = "http://test.local/api/songs/song_owner",
): NextRequest {
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;
}

function ctx(id = "song_owner") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: { id: "usr_owner", email: null, name: "Owner", avatarUrl: null },
    source: "session",
    sessionId: "sess_owner",
  };
  nextSong = {
    id: "song_owner",
    userId: "usr_owner",
    title: "Owned Song",
  };
  nextUpdatedSong = {
    id: "song_owner",
    userId: "usr_owner",
    title: "Renamed Song",
  };
  nextDeleteResult = true;
  updateSongError = null;
  getSongByIdForUserMock.mockClear();
  getSongSummaryByIdForUserMock.mockClear();
  updateSongForUserMock.mockClear();
  deleteSongForUserMock.mockClear();
  resetLocalSongFallbackForTests();
});

describe("GET /api/songs/[id]", () => {
  it("reads songs through an owner-scoped query", async () => {
    const response = await GET(request("GET"), ctx("song_owner"));

    expect(response.status).toBe(200);
    expect(getSongByIdForUserMock).toHaveBeenCalledWith("song_owner", "usr_owner");
    const body = await response.json() as Record<string, unknown>;
    expect(body.userId).toBe("usr_owner");
  });

  it("serves ?view=summary through the projection query", async () => {
    const response = await GET(
      request("GET", undefined, "http://test.local/api/songs/song_owner?view=summary"),
      ctx("song_owner"),
    );

    expect(response.status).toBe(200);
    expect(getSongSummaryByIdForUserMock).toHaveBeenCalledWith("song_owner", "usr_owner");
    expect(getSongByIdForUserMock).not.toHaveBeenCalled();
  });

  it("does not expose guest songs to a different authenticated user", async () => {
    nextSong = null;

    const response = await GET(request("GET"), ctx("song_guest"));

    expect(response.status).toBe(404);
    expect(getSongByIdForUserMock).toHaveBeenCalledWith("song_guest", "usr_owner");
  });
});

describe("PATCH /api/songs/[id]", () => {
  it("updates only through the owner-scoped query", async () => {
    const response = await PATCH(request("PATCH", { title: "Renamed Song" }), ctx());

    expect(response.status).toBe(200);
    expect(updateSongForUserMock).toHaveBeenCalledWith(
      "song_owner",
      "usr_owner",
      { title: "Renamed Song" },
    );
  });

  it("accepts curated artwork metadata when updating visual config", async () => {
    const visualConfig = {
      preset: "warm_particles",
      gradient: "linear-gradient(135deg, #5A8EAA, #DFE0DA)",
      particleDensity: 0.5,
      pulseSource: "melody",
      visualFacets: {
        genre: "surf rock",
        mood: "glowing",
        energy: 0.7,
      },
      artwork: {
        id: "tidal_mineral-met-11129",
        bucket: "tidal_mineral",
        title: "Natural Bridge, Bermuda",
        artist: "Winslow Homer",
        year: "ca. 1901",
        source: "met",
        sourceUrl: "https://www.metmuseum.org/art/collection/search/11129",
        imagePath: "/artworks/tidal_mineral/met-11129-natural-bridge-bermuda.jpg",
        license: "Public Domain",
        crop: { x: 0.48, y: 0.56, scale: 1.04 },
      },
    };
    nextUpdatedSong = {
      id: "song_owner",
      userId: "usr_owner",
      title: "Owned Song",
      visualConfig,
    };

    const response = await PATCH(request("PATCH", { visualConfig }), ctx());

    expect(response.status).toBe(200);
    expect(updateSongForUserMock).toHaveBeenCalledWith(
      "song_owner",
      "usr_owner",
      { visualConfig },
    );
    const body = await response.json() as Record<string, unknown>;
    expect(body.visualConfig).toEqual(visualConfig);
  });

  it("rejects attempts to update protected or unknown fields", async () => {
    const response = await PATCH(
      request("PATCH", {
        title: "Takeover",
        userId: "usr_other",
      }),
      ctx(),
    );

    expect(response.status).toBe(400);
    expect(updateSongForUserMock).not.toHaveBeenCalled();
    const body = await response.json() as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("updates the local guest fallback when the dev database is unavailable", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
      source: "guest",
      sessionId: "sess_guest",
    };
    updateSongError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    createLocalSongFallback({
      id: "song_guest",
      userId: "guest",
      title: "Before Rename",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
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

    const response = await PATCH(
      request(
        "PATCH",
        { title: "After Rename" },
        "http://localhost/api/songs/song_guest",
      ),
      ctx("song_guest"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Murmur-Fallback")).toBe("local-guest-song");
    const body = await response.json() as Record<string, unknown>;
    expect(body.title).toBe("After Rename");
  });
});

describe("DELETE /api/songs/[id]", () => {
  it("deletes only through the owner-scoped query", async () => {
    const response = await DELETE(request("DELETE"), ctx());

    expect(response.status).toBe(200);
    expect(deleteSongForUserMock).toHaveBeenCalledWith("song_owner", "usr_owner");
  });

  it("returns 404 when the song is not owned by the requester", async () => {
    nextDeleteResult = false;

    const response = await DELETE(request("DELETE"), ctx("song_other"));

    expect(response.status).toBe(404);
    expect(deleteSongForUserMock).toHaveBeenCalledWith("song_other", "usr_owner");
  });
});
