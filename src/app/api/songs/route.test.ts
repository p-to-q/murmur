import { beforeEach, afterEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import {
  __resetObjectStoreForTesting,
  __setObjectStoreForTesting,
  type ObjectStore,
} from "@/lib/storage";
import { computeSaveFingerprint } from "@/modules/music/song-artifact";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import { validMp3DataUrl } from "@/lib/test/audio-fixtures";

const BASE_VISUAL_CONFIG = {
  preset: "soft_gradient",
  gradient: "linear-gradient(135deg, #f6d365, #fda085)",
  particleDensity: 0.4,
  pulseSource: "energy" as const,
};

const BASE_ARRANGEMENT = {
  melody: { enabled: true, intensity: 0.8, originalPattern: "60", currentPattern: "60", instrument: "piano", versionHistory: [] },
  chords: { enabled: true, intensity: 0.6, originalPattern: "gen:sunset", currentPattern: "gen:sunset", instrument: "felt_piano", versionHistory: [] },
  strings: { enabled: false, intensity: 0.3, originalPattern: "pad", currentPattern: "pad", instrument: "string_ensemble", versionHistory: [] },
  drums: { enabled: false, intensity: 0.2, originalPattern: "none", currentPattern: "none", instrument: "brush_kit", versionHistory: [] },
  bass: { enabled: true, intensity: 0.4, originalPattern: "root", currentPattern: "root", instrument: "upright_bass", versionHistory: [] },
  texture: { enabled: true, intensity: 0.2, originalPattern: "air", currentPattern: "air", instrument: "vinyl_noise", versionHistory: [] },
};

// 1x1 silent-ish MP3 payload stand-in — the route only needs decodable bytes.
const SAMPLE_MP3_DATA_URL = validMp3DataUrl();

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_song", email: null, name: "Song Tester", avatarUrl: null },
  source: "guest",
  sessionId: "sess_song",
};

const createdSongs: Array<Record<string, unknown>> = [];
const compositionEvents: Array<Record<string, unknown>> = [];
const createCompositionEventMock = mock(async (data: Record<string, unknown>) => {
  compositionEvents.push(data);
  return {
    id: "cmp_test",
    ...data,
    occurredAt: new Date("2026-06-05T12:00:00.000Z"),
    createdAt: new Date("2026-06-05T12:00:00.000Z"),
  };
});
let generationEvidenceVerified = true;
let generationEvidenceError: unknown = null;
const hasVerifiedGenerationEvidenceMock = mock(async () => {
  if (generationEvidenceError) throw generationEvidenceError;
  return generationEvidenceVerified;
});
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
let existingConflictSong: Record<string, unknown> | null = null;
let songSummaries: Array<Record<string, unknown>> = [];
let getSongSummariesError: unknown = null;
const getSongByIdMock = mock(async (songId: string) =>
  existingConflictSong?.id === songId ? existingConflictSong : null,
);
const reserveSongAudioObjectMock = mock(async () => undefined);

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/songs", () => ({
  createSong: createSongMock,
  createSongWithSpend: createSongWithSpendMock,
  deleteSong: mock(async () => false),
  deleteSongForUser: mock(async () => false),
  getPublicSongByShareCode: mock(async () => null),
  getPublicSongMetadataByShareCode: mock(async () => null),
  getPublicSongSummaries: mock(async () => []),
  getSongById: getSongByIdMock,
  getSongByIdForUser: mock(async () => null),
  getSongByShareCode: mock(async () => null),
  getSongShareMetaByShareCode: mock(async () => null),
  getSongSummariesByUser: mock(async () => {
    if (getSongSummariesError) throw getSongSummariesError;
    return songSummaries;
  }),
  getSongSummaryByIdForUser: mock(async () => null),
  publishSongShareForUser: mock(async () => null),
  revokeSongShareForUser: mock(async () => null),
  updateSong: mock(async () => null),
  updateSongForUser: mock(async () => null),
}));

mock.module("@/lib/db/queries/composition-events", () => ({
  createCompositionEvent: createCompositionEventMock,
  hasVerifiedGenerationEvidence: hasVerifiedGenerationEvidenceMock,
  listCompositionTrainingExamples: mock(async () => []),
}));

mock.module("@/lib/db/queries/song-audio-objects", () => ({
  reserveSongAudioObject: reserveSongAudioObjectMock,
  claimDueSongAudioObjects: mock(async () => []),
  markSongAudioObjectDeleted: mock(async () => undefined),
  markSongAudioObjectRetry: mock(async () => undefined),
  songAudioObjectRetryAt: (_attempts: number, now: Date) => now,
}));

const { GET, POST } = await import("./route");
const {
  createLocalSongFallback,
  resetLocalSongFallbackForTests,
} = await import("@/lib/db/queries/local-song-fallback");

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

beforeEach(async () => {
  delete process.env.MURMUR_RATE_LIMIT_DRIVER;
  resetCachedRateLimitStore();
  await getRateLimitStore().resetAll();
  nextAuth = {
    ok: true,
    user: { id: "usr_song", email: null, name: "Song Tester", avatarUrl: null },
    source: "guest",
    sessionId: "sess_song",
  };
  createdSongs.length = 0;
  compositionEvents.length = 0;
  createSongMock.mockClear();
  createSongWithSpendMock.mockClear();
  createCompositionEventMock.mockClear();
  hasVerifiedGenerationEvidenceMock.mockClear();
  getSongByIdMock.mockClear();
  reserveSongAudioObjectMock.mockClear();
  createSongError = null;
  createSongWithSpendError = null;
  generationEvidenceVerified = true;
  generationEvidenceError = null;
  existingConflictSong = null;
  songSummaries = [];
  getSongSummariesError = null;
  resetLocalSongFallbackForTests();
  __resetObjectStoreForTesting();
});

describe("GET /api/songs", () => {
  it("keeps the N-1 mp3Url alias on audio-bearing summaries", async () => {
    songSummaries = [{
      id: "song_summary",
      title: "Summary Song",
      hasAudio: true,
      legacyAudioUrl: null,
    }];

    const response = await GET(new Request("http://test.local/api/songs", {
      headers: { "x-request-id": "req_song_list" },
    }) as unknown as NextRequest);
    const [song] = await response.json() as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(song?.audioUrl).toBe("/api/songs/song_summary/audio");
    expect(song?.mp3Url).toBe(song?.audioUrl);
    expect(song).not.toHaveProperty("legacyAudioUrl");
  });

  it("keeps the N-1 alias in the demo-safe local-store fallback", async () => {
    getSongSummariesError = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    createLocalSongFallback({
      id: "song_local_summary",
      userId: "usr_song",
      title: "Local Summary",
      vibe: "soft",
      vibeEn: "soft",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 12,
      mp3DataUrl: SAMPLE_MP3_DATA_URL,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    });

    const response = await GET(new Request("http://localhost:3000/api/songs", {
      headers: { "x-request-id": "req_local_song_list" },
    }) as unknown as NextRequest);
    const [song] = await response.json() as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(song?.audioUrl).toBe("/api/songs/song_local_summary/audio");
    expect(song?.mp3Url).toBe(song?.audioUrl);
  });
});

afterEach(() => {
  __resetObjectStoreForTesting();
});

function makeRecordingStore(): {
  store: ObjectStore;
  puts: Array<{ key: string; body: Uint8Array }>;
  deletes: string[];
} {
  const puts: Array<{ key: string; body: Uint8Array }> = [];
  const deletes: string[] = [];
  const objects = new Map<string, {
    body: Uint8Array;
    contentType: string;
    scope: "public" | "private";
  }>();
  const store: ObjectStore = {
    driver: "memory",
    async put(key, body, opts) {
      const storedBody = new Uint8Array(body);
      puts.push({ key, body: storedBody });
      objects.set(key, {
        body: storedBody,
        contentType: opts.contentType,
        scope: opts.scope ?? "private",
      });
      return {
        key,
        url: `https://cdn.test/${key}`,
        size: body.byteLength,
        contentType: opts.contentType,
        scope: opts.scope ?? "private",
        storedAt: new Date("2026-06-05T12:00:00.000Z"),
      };
    },
    async get(key) {
      const object = objects.get(key);
      return object
        ? {
            ...object,
            size: object.body.byteLength,
            meta: {},
            storedAt: new Date("2026-06-05T12:00:00.000Z"),
          }
        : null;
    },
    async delete(key) {
      deletes.push(key);
      objects.delete(key);
    },
    url(key) {
      return `https://cdn.test/${key}`;
    },
  };
  return { store, puts, deletes };
}

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

  it("preserves curated artwork metadata inside the saved visual config", async () => {
    const artwork = {
      id: "tidal_mineral-met-11129",
      bucket: "tidal_mineral",
      title: "Natural Bridge, Bermuda",
      artist: "Winslow Homer",
      year: "ca. 1901",
      source: "met",
      sourceUrl: "https://www.metmuseum.org/art/collection/search/11129",
      imagePath: "/artworks/tidal_mineral/met-11129-natural-bridge-bermuda.jpg",
      license: "Public Domain" as const,
      crop: { x: 0.48, y: 0.56, scale: 1.04 },
    };

    const response = await POST(buildRequest({
      id: "song_artwork",
      title: "Mineral Tide",
      vibe: "surf rock",
      vibeEn: "surf rock",
      bpm: 96,
      keySignature: "D",
      scaleType: "minor",
      duration: 24,
      visualConfig: {
        preset: "warm_particles",
        gradient: "linear-gradient(135deg, #5A8EAA, #DFE0DA)",
        particleDensity: 0.5,
        pulseSource: "melody",
        visualFacets: {
          genre: "surf rock",
          mood: "glowing",
          instrument: "slide guitar",
          energy: 0.7,
        },
        artwork,
      },
      arrangementState: {
        melody: { enabled: true, intensity: 0.8, originalPattern: "62 64 65", currentPattern: "62 64 65", instrument: "piano", versionHistory: [] },
        chords: { enabled: true, intensity: 0.7, originalPattern: "gen:surf", currentPattern: "gen:surf", instrument: "felt_piano", versionHistory: [] },
        strings: { enabled: true, intensity: 0.4, originalPattern: "pad", currentPattern: "pad", instrument: "string_ensemble", versionHistory: [] },
        drums: { enabled: true, intensity: 0.5, originalPattern: "brush", currentPattern: "brush", instrument: "brush_kit", versionHistory: [] },
        bass: { enabled: true, intensity: 0.5, originalPattern: "root", currentPattern: "root", instrument: "upright_bass", versionHistory: [] },
        texture: { enabled: true, intensity: 0.3, originalPattern: "salt", currentPattern: "salt", instrument: "vinyl_noise", versionHistory: [] },
      },
      tags: ["surf rock", "glowing"],
    }));

    expect(response.status).toBe(200);
    expect(createdSongs).toHaveLength(1);
    expect(createdSongs[0]?.visualConfig).toEqual(expect.objectContaining({
      artwork,
      visualFacets: expect.objectContaining({
        genre: "surf rock",
        mood: "glowing",
      }),
    }));

    const body = await response.json() as Record<string, unknown>;
    expect(body.visualConfig).toEqual(expect.objectContaining({ artwork }));
  });

  it("rejects an unknown source melody kind with an explicit validation error (#311)", async () => {
    const response = await POST(buildRequest({
      id: "song_bad_kind",
      title: "Plain Draft",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      sourceMelodyKind: "unknown",
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    // Explicit validation error, not a silent fallback to "corrected".
    expect(response.status).toBe(400);
    expect(createdSongs).toHaveLength(0);
    const body = await response.json() as { error: string; issues: Array<{ path: string }> };
    expect(body.error).toBe("validation_error");
    expect(body.issues.some((issue) => issue.path === "sourceMelodyKind")).toBe(true);
  });

  it("defaults to corrected and normalizes lineage/edit counts when the kind is omitted", async () => {
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
      editCount: -9,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
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

  it("rejects more tags than the bound allows (#311)", async () => {
    const response = await POST(buildRequest({
      id: "song_too_many_tags",
      title: "Tag Flood",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: Array.from({ length: 40 }, (_, i) => `tag-${i}`),
    }));

    expect(response.status).toBe(400);
    expect(createdSongs).toHaveLength(0);
    const body = await response.json() as { error: string; issues: Array<{ path: string }> };
    expect(body.error).toBe("validation_error");
    expect(body.issues.some((issue) => issue.path === "tags")).toBe(true);
  });

  it("rejects an artwork palette that exceeds the item bound (#311)", async () => {
    const response = await POST(buildRequest({
      id: "song_palette_flood",
      title: "Palette Flood",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      visualConfig: {
        ...BASE_VISUAL_CONFIG,
        artwork: {
          id: "art_1",
          bucket: "tidal_mineral",
          title: "Test",
          artist: "Tester",
          year: "2026",
          source: "met",
          sourceUrl: "https://example.com/art",
          imagePath: "/artworks/x.jpg",
          license: "Public Domain",
          crop: { x: 0.5, y: 0.5, scale: 1 },
          palette: Array.from({ length: 40 }, () => "#abcdef"),
        },
      },
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    expect(response.status).toBe(400);
    expect(createdSongs).toHaveLength(0);
    const body = await response.json() as { error: string; issues: Array<{ path: string }> };
    expect(body.error).toBe("validation_error");
    expect(body.issues.some((issue) => issue.path.includes("palette"))).toBe(true);
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

  it("returns a conflict instead of overwriting an existing song id", async () => {
    createSongError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "songs_pkey",
    });

    const response = await POST(buildRequest({
      id: "song_existing_elsewhere",
      title: "Collision Draft",
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
    }));

    expect(response.status).toBe(409);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("song_id_conflict");
    expect(response.headers.get("X-Request-Id")).toBe("req_song");
    expect(getSongByIdMock).toHaveBeenCalledTimes(1);
  });

  it("replays the existing song when a same-user create is retried", async () => {
    createSongError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "songs_pkey",
    });
    existingConflictSong = {
      id: "song_retry",
      userId: "usr_song",
      title: "Already Saved",
    };

    const response = await POST(buildRequest({
      id: "song_retry",
      title: "Already Saved",
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
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Murmur-Idempotent-Replay")).toBe("song");
    const body = await response.json() as { id: string; userId: string };
    expect(body.id).toBe("song_retry");
    expect(body.userId).toBe("usr_song");
  });

  it("does not report unrelated unique violations as song id conflicts", async () => {
    createSongError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "notes_ledger_idempotency_key_idx",
      detail: "Key (idempotency_key)=(req_song) already exists.",
    });

    const response = await POST(buildRequest({
      id: "song_unique_elsewhere",
      title: "Ledger Collision",
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
    }));

    expect(response.status).toBe(500);
    const body = await response.json() as { error: string; message?: string };
    expect(body.error).toBe("server_error");
    expect(body.message).toBe("Failed to save song");
    expect(getSongByIdMock).toHaveBeenCalledTimes(0);
  });

  it("does not report another table primary-key collision as a song id conflict", async () => {
    createSongError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "notes_ledger_pkey",
      table: "notes_ledger",
      detail: "Key (id)=(ledger_existing) already exists.",
    });

    const response = await POST(buildRequest({
      id: "song_unique_primary_elsewhere",
      title: "Ledger Primary Collision",
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
    }));

    expect(response.status).toBe(500);
    const body = await response.json() as { error: string; message?: string };
    expect(body.error).toBe("server_error");
    expect(body.message).toBe("Failed to save song");
    expect(getSongByIdMock).toHaveBeenCalledTimes(0);
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

  it("returns 503 instead of a volatile fallback for registered saves when the database is unavailable", async () => {
    nextAuth = {
      ok: true,
      user: {
        id: "usr_registered",
        email: "registered@example.com",
        name: "Registered",
        avatarUrl: null,
        accountKind: "registered",
      },
      source: "session",
      sessionId: "sess_registered",
    };
    const dbUnavailableError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    createSongError = dbUnavailableError;
    createSongWithSpendError = dbUnavailableError;

    const response = await POST(buildRequest({
      id: "song_registered_db_down",
      title: "Registered Draft",
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
    }, "req_registered_db_down", "https://murmur.example/api/songs"));

    expect(response.status).toBe(503);
    expect(response.headers.get("X-Murmur-Fallback")).toBeNull();
    expect(createdSongs).toHaveLength(0);
    const body = await response.json() as { error?: string; requestId?: string };
    expect(body.error).toBe("save_unavailable");
    expect(body.requestId).toBe("req_registered_db_down");
  });

  it("uploads rendered audio privately and persists its controlled route, not base64 (#292)", async () => {
    const { store, puts } = makeRecordingStore();
    __setObjectStoreForTesting(store);

    const response = await POST(buildRequest({
      id: "song_audio_object",
      title: "Object Master",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      mp3DataUrl: SAMPLE_MP3_DATA_URL,
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
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toContain("songs/master/usr_song/song_audio_object");
    expect(createdSongs).toHaveLength(1);
    // The persisted row references object storage and carries NO embedded base64.
    expect(createdSongs[0]?.mp3Url).toBe("/api/songs/song_audio_object/audio");
    expect(createdSongs[0]?.mp3StorageKey).toBe(puts[0]!.key);
    expect(createdSongs[0]?.mp3DataUrl).toBeNull();
    expect(response.headers.get("X-Murmur-Audio-Storage")).toBeNull();
    const body = await response.json() as Record<string, unknown>;
    expect(body.audioUrl).toBe("/api/songs/song_audio_object/audio");
    expect(body.mp3Url).toBe(body.audioUrl);
    expect(body).not.toHaveProperty("mp3StorageKey");
    expect(body).not.toHaveProperty("mp3DataUrl");
  });

  it("leaves its unique pending master for outbox cleanup when account deletion wins", async () => {
    const { store, puts, deletes } = makeRecordingStore();
    __setObjectStoreForTesting(store);
    createSongError = new Error("account_deleted_or_missing");

    const response = await POST(buildRequest({
      id: "song_deleted_account_race",
      title: "Closing Draft",
      vibe: "quiet",
      vibeEn: "quiet",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      mp3DataUrl: SAMPLE_MP3_DATA_URL,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    expect(response.status).toBe(500);
    expect(puts).toHaveLength(1);
    expect(deletes).toEqual([]);
    expect(createdSongs).toHaveLength(0);
  });

  it("does not overwrite stored audio when the same song id conflicts", async () => {
    const { store, puts } = makeRecordingStore();
    __setObjectStoreForTesting(store);
    const payload = {
      id: "song_audio_conflict",
      title: "Original Master",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      mp3DataUrl: SAMPLE_MP3_DATA_URL,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    };

    expect((await POST(buildRequest(payload))).status).toBe(200);
    existingConflictSong = { ...createdSongs[0] };
    const originalKey = String(createdSongs[0]?.mp3StorageKey);
    const originalBytes = new Uint8Array(puts[0]!.body);
    const differentAudio = validMp3DataUrl(1);

    const response = await POST(buildRequest({
      ...payload,
      title: "Conflicting Master",
      mp3DataUrl: differentAudio,
    }, "req_audio_conflict"));

    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("song_payload_conflict");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toBe(originalKey);
    expect(puts[0]?.body).toEqual(originalBytes);
  });

  it("replays the same audio payload without rewriting its object", async () => {
    const { store, puts } = makeRecordingStore();
    __setObjectStoreForTesting(store);
    const payload = {
      id: "song_audio_replay",
      title: "Replay Master",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      mp3DataUrl: SAMPLE_MP3_DATA_URL,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    };

    expect((await POST(buildRequest(payload))).status).toBe(200);
    existingConflictSong = { ...createdSongs[0] };
    const replay = await POST(buildRequest(payload, "req_audio_replay"));

    expect(replay.status).toBe(200);
    expect(replay.headers.get("X-Murmur-Idempotent-Replay")).toBe("song");
    expect(puts).toHaveLength(1);
    expect(createSongMock).toHaveBeenCalledTimes(1);
  });

  it("persists no audio fields when the save carries no rendered audio (#292)", async () => {
    __setObjectStoreForTesting(makeRecordingStore().store);
    const response = await POST(buildRequest({
      id: "song_audio_none",
      title: "Silent Draft",
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
    }));

    expect(response.status).toBe(200);
    expect(createdSongs[0]?.mp3Url).toBeNull();
    expect(createdSongs[0]?.mp3StorageKey).toBeNull();
    expect(createdSongs[0]?.mp3DataUrl).toBeNull();
  });

  it("falls back to an embedded data URL and flags it when object storage is unavailable (#292)", async () => {
    const failingStore: ObjectStore = {
      driver: "memory",
      async put() {
        throw new Error("driver_unconfigured");
      },
      async get() {
        return null;
      },
      async delete() {},
      url(key) {
        return `memory://${key}`;
      },
    };
    __setObjectStoreForTesting(failingStore);

    const response = await POST(buildRequest({
      id: "song_audio_fallback",
      title: "Fallback Master",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      mp3DataUrl: SAMPLE_MP3_DATA_URL,
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
    expect(response.headers.get("X-Murmur-Audio-Storage")).toBe("fallback-data-url");
    expect(createdSongs[0]?.mp3Url).toBeNull();
    expect(createdSongs[0]?.mp3DataUrl).toBe(SAMPLE_MP3_DATA_URL);
  });

  it("rejects mislabeled audio bytes instead of persisting a broken artifact", async () => {
    __setObjectStoreForTesting(makeRecordingStore().store);
    const response = await POST(buildRequest({
      id: "song_invalid_audio",
      title: "Broken Master",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      mp3DataUrl: `data:audio/mpeg;base64,${Buffer.from("upstream error").toString("base64")}`,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    expect(response.status).toBe(422);
    expect((await response.json() as { error: string }).error).toBe("invalid_audio");
    expect(createdSongs).toHaveLength(0);
  });

  it("stamps the artifact version and persists the canonical melody + provenance (#297)", async () => {
    const melody = {
      notes: [{ pitch: 62, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 }],
      key: "D",
      scale: "minor",
      bpm: 92,
      duration: 12,
      contour: "wave",
    };
    const response = await POST(buildRequest({
      id: "song_artifact_v2",
      title: "Versioned",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 92,
      keySignature: "D",
      scaleType: "minor",
      duration: 12,
      melody,
      provenance: { flow: "flow_abc", draftId: "draft_abc", sourceType: "hum" },
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: ["night"],
    }));

    expect(response.status).toBe(200);
    expect(createdSongs[0]?.artifactVersion).toBe(2);
    expect(createdSongs[0]?.melody).toEqual(melody);
    expect(createdSongs[0]?.provenance).toEqual({ flow: "flow_abc", draftId: "draft_abc", sourceType: "hum" });
    expect(typeof createdSongs[0]?.saveFingerprint).toBe("string");
    expect(createCompositionEventMock).toHaveBeenCalledTimes(1);
    expect(compositionEvents[0]).toEqual(expect.objectContaining({
      userId: "usr_song",
      songId: "song_artifact_v2",
      draftId: "draft_abc",
      flowId: "flow_abc",
      eventKind: "song.saved",
      source: "server",
    }));
    expect(compositionEvents[0]?.payload).toEqual(expect.objectContaining({
      requestId: "req_song",
      artifactVersion: 2,
      sourceMelodyKind: "corrected",
      hasAudio: false,
      audioStorage: "none",
    }));
  });

  it("persists generation provenance only when the server evidence tuple is verified", async () => {
    const generationAudioSha256 = "A".repeat(64);
    const response = await POST(buildRequest({
      id: "song_verified_generation",
      title: "Verified Generation",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 92,
      keySignature: "D",
      scaleType: "minor",
      duration: 12,
      provenance: {
        flow: "flow_verified",
        generationBatchId: "batch_verified",
        generationClipId: "clip_verified",
        generationAudioSha256,
        generationBatchIndex: 1,
      },
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    expect(response.status).toBe(200);
    expect(hasVerifiedGenerationEvidenceMock).toHaveBeenCalledWith({
      userId: "usr_song",
      generationBatchId: "batch_verified",
      generationClipId: "clip_verified",
      outputSha256: generationAudioSha256.toLowerCase(),
    });
    expect(createdSongs[0]?.provenance).toEqual({
      flow: "flow_verified",
      generationBatchId: "batch_verified",
      generationClipId: "clip_verified",
      generationAudioSha256: generationAudioSha256.toLowerCase(),
      generationBatchIndex: 1,
    });
  });

  it("strips an unverified generation identity while preserving other provenance", async () => {
    generationEvidenceVerified = false;
    const response = await POST(buildRequest({
      id: "song_unverified_generation",
      title: "Unverified Generation",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 92,
      keySignature: "D",
      scaleType: "minor",
      duration: 12,
      provenance: {
        flow: "flow_unverified",
        draftId: "draft_unverified",
        sourceType: "hum",
        generationBatchId: "batch_unverified",
        generationClipId: "clip_unverified",
        generationAudioSha256: "b".repeat(64),
        generationBatchIndex: 2,
      },
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    expect(response.status).toBe(200);
    expect(createdSongs[0]?.provenance).toEqual({
      flow: "flow_unverified",
      draftId: "draft_unverified",
      sourceType: "hum",
    });
  });

  it("keeps saving when generation evidence validation is unavailable", async () => {
    generationEvidenceError = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const response = await POST(buildRequest({
      id: "song_generation_validation_down",
      title: "Local Evidence Fallback",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 92,
      keySignature: "D",
      scaleType: "minor",
      duration: 12,
      provenance: {
        flow: "flow_local",
        sourceType: "demo",
        generationBatchId: "batch_local",
        generationClipId: "clip_local",
        generationAudioSha256: "c".repeat(64),
        generationBatchIndex: 0,
      },
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    expect(response.status).toBe(200);
    expect(createdSongs[0]?.provenance).toEqual({
      flow: "flow_local",
      sourceType: "demo",
    });
  });

  it("derives root + depth from the owned parent, overriding client-supplied lineage (#297)", async () => {
    existingConflictSong = {
      id: "song_parent",
      userId: "usr_song",
      rootSongId: "song_true_root",
      lineageDepth: 3,
    };

    const response = await POST(buildRequest({
      id: "song_child",
      title: "Child Branch",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      parentSongId: "song_parent",
      // Client lies about root/depth — the server must ignore these.
      rootSongId: "client_root_lie",
      lineageDepth: 0,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    expect(response.status).toBe(200);
    expect(createdSongs[0]?.parentSongId).toBe("song_parent");
    expect(createdSongs[0]?.rootSongId).toBe("song_true_root");
    expect(createdSongs[0]?.lineageDepth).toBe(4);
  });

  it("returns a payload conflict when a same-id save carries different content (#297)", async () => {
    createSongError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "songs_pkey",
    });
    existingConflictSong = {
      id: "song_fp",
      userId: "usr_song",
      title: "Original Content",
      saveFingerprint: "not-a-matching-fingerprint",
    };

    const response = await POST(buildRequest({
      id: "song_fp",
      title: "Different Content",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    expect(response.status).toBe(409);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("song_payload_conflict");
  });

  it("replays idempotently when a same-id save carries matching content (#297)", async () => {
    const matchingFingerprint = computeSaveFingerprint({
      title: "Same Content",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      sourceMelodyKind: "corrected",
      editCount: 0,
      editDepth: "fresh",
      parentSongId: null,
      rootSongId: "song_fp_match",
      lineageDepth: 0,
      tags: [],
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      melody: null,
      provenance: null,
      mp3Url: null,
      mp3StorageKey: null,
      mp3DataUrl: null,
    });
    createSongError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "songs_pkey",
    });
    existingConflictSong = {
      id: "song_fp_match",
      userId: "usr_song",
      title: "Same Content",
      saveFingerprint: matchingFingerprint,
    };

    const response = await POST(buildRequest({
      id: "song_fp_match",
      title: "Same Content",
      vibe: "sunset",
      vibeEn: "sunset",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 20,
      visualConfig: BASE_VISUAL_CONFIG,
      arrangementState: BASE_ARRANGEMENT,
      tags: [],
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Murmur-Idempotent-Replay")).toBe("song");
  });
});
