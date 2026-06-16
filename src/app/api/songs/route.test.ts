import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_song", email: null, name: "Song Tester", avatarUrl: null },
  source: "guest",
  sessionId: "sess_song",
};

const createdSongs: Array<Record<string, unknown>> = [];
let createSongError: unknown = null;
const createSongMock = mock(async (data: Record<string, unknown>) => {
  if (createSongError) throw createSongError;
  createdSongs.push(data);
  return {
    ...data,
    createdAt: new Date("2026-06-05T12:00:00.000Z"),
    updatedAt: new Date("2026-06-05T12:00:00.000Z"),
  };
});
let createSongWithSpendError: unknown = null;
const createSongWithSpendMock = mock(async (data: Record<string, unknown>) => {
  if (createSongWithSpendError) throw createSongWithSpendError;
  createdSongs.push(data);
  return {
    ok: true as const,
    song: {
      ...data,
      createdAt: new Date("2026-06-05T12:00:00.000Z"),
      updatedAt: new Date("2026-06-05T12:00:00.000Z"),
    },
    spend: {
      ok: true as const,
      ledgerId: "nle_song",
      balanceBefore: 10,
      balanceAfter: 9,
      duplicate: false,
    },
  };
});

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/songs", () => ({
  getSongsByUser: mock(async () => []),
  getSongByIdForUser: mock(async () => null),
  createSong: createSongMock,
  createSongWithSpend: createSongWithSpendMock,
  updateSongForUser: mock(async () => null),
  deleteSongForUser: mock(async () => false),
}));

const { POST } = await import("./route");
const { resetLocalSongFallbackForTests } = await import("@/lib/db/queries/local-song-fallback");

function buildRequest(
  body: Record<string, unknown>,
  requestId = "req_song",
  url = "http://test.local/api/songs",
): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  delete process.env.MURMUR_RATE_LIMIT_DRIVER;
  resetCachedRateLimitStore();
  getRateLimitStore().resetAll();
  nextAuth = {
    ok: true,
    user: { id: "usr_song", email: null, name: "Song Tester", avatarUrl: null },
    source: "guest",
    sessionId: "sess_song",
  };
  createdSongs.length = 0;
  createSongMock.mockClear();
  createSongWithSpendMock.mockClear();
  createSongError = null;
  createSongWithSpendError = null;
  resetLocalSongFallbackForTests();
});

describe("POST /api/songs", () => {
  it("persists the selected source melody kind with the saved song", async () => {
    const response = await POST(buildRequest({
      id: "song_1",
      title: "Hushed Tide",
      vibe: "midnight",
      vibeEn: "midnight",
      bpm: 92,
      keySignature: "C",
      scaleType: "minor",
      duration: 31,
      parentSongId: "song_seed",
      rootSongId: "song_root",
      lineageDepth: 2,
      sourceMelodyKind: "musical",
      editCount: 5,
      visualConfig: {
        preset: "warm_particles",
        gradient: "linear-gradient(135deg, #FF8A5C, #FF5924)",
        particleDensity: 0.7,
        pulseSource: "melody",
      },
      arrangementState: {
        melody: { enabled: true, intensity: 0.8, originalPattern: "60 62 64", currentPattern: "60 62 64", instrument: "piano", versionHistory: [] },
        chords: { enabled: true, intensity: 0.7, originalPattern: "gen:midnight", currentPattern: "gen:midnight", instrument: "felt_piano", versionHistory: [] },
        strings: { enabled: true, intensity: 0.5, originalPattern: "pad", currentPattern: "pad", instrument: "string_ensemble", versionHistory: [] },
        drums: { enabled: false, intensity: 0.3, originalPattern: "brush", currentPattern: "brush", instrument: "brush_kit", versionHistory: [] },
        bass: { enabled: true, intensity: 0.5, originalPattern: "root", currentPattern: "root", instrument: "upright_bass", versionHistory: [] },
        texture: { enabled: true, intensity: 0.4, originalPattern: "dust", currentPattern: "dust", instrument: "vinyl_noise", versionHistory: [] },
      },
      tags: ["night"],
    }));

    expect(response.status).toBe(200);
    expect(createdSongs).toHaveLength(1);
    expect(createdSongs[0]?.userId).toBe("usr_song");
    expect(createdSongs[0]?.parentSongId).toBe("song_seed");
    expect(createdSongs[0]?.rootSongId).toBe("song_root");
    expect(createdSongs[0]?.lineageDepth).toBe(2);
    expect(createdSongs[0]?.sourceMelodyKind).toBe("musical");
    expect(createdSongs[0]?.editCount).toBe(5);
    expect(createdSongs[0]?.editDepth).toBe("reworked");

    const body = await response.json() as Record<string, unknown>;
    expect(body.sourceMelodyKind).toBe("musical");
    expect(body.editDepth).toBe("reworked");
    expect(createSongMock).toHaveBeenCalledTimes(1);
    expect(createSongWithSpendMock).toHaveBeenCalledTimes(0);
  });

  it("falls back to corrected when the request sends an unknown melody kind", async () => {
    const response = await POST(buildRequest({
      id: "song_2",
      title: "Plain Draft",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      lineageDepth: -3,
      sourceMelodyKind: "unknown",
      editCount: -9,
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
    }));

    expect(response.status).toBe(200);
    expect(createdSongs[0]?.sourceMelodyKind).toBe("corrected");
    expect(createdSongs[0]?.parentSongId).toBeNull();
    expect(createdSongs[0]?.rootSongId).toBe("song_2");
    expect(createdSongs[0]?.lineageDepth).toBe(0);
    expect(createdSongs[0]?.editCount).toBe(0);
    expect(createdSongs[0]?.editDepth).toBe("fresh");

    const body = await response.json() as Record<string, unknown>;
    expect(body.sourceMelodyKind).toBe("corrected");
    expect(body.editDepth).toBe("fresh");
  });

  it("rejects malformed payloads instead of forwarding raw JSON into persistence", async () => {
    const response = await POST(buildRequest({
      id: "song_bad",
      title: "Broken Draft",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: "fast",
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
      injected: { shouldNotPersist: true },
    } as unknown as Record<string, unknown>));

    expect(response.status).toBe(400);
    expect(createdSongs).toHaveLength(0);
    const body = await response.json() as { error: string; issues: Array<{ path: string }> };
    expect(body.error).toBe("validation_error");
    expect(body.issues.some((issue) => issue.path === "bpm")).toBe(true);
  });

  it("uses a local guest song fallback when the dev database is unavailable", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Guest", avatarUrl: null },
      source: "guest",
      sessionId: "sess_guest",
    };
    const dbUnavailableError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    createSongError = dbUnavailableError;
    createSongWithSpendError = dbUnavailableError;

    const response = await POST(buildRequest({
      id: "song_guest_fallback",
      title: "Local Draft",
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
    }, "req_guest_fallback", "http://localhost/api/songs"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Murmur-Fallback")).toBe("local-song");
    expect(createdSongs).toHaveLength(0);
    const body = await response.json() as Record<string, unknown>;
    expect(body.id).toBe("song_guest_fallback");
    expect(body.userId).toBe("guest");
  });
});
