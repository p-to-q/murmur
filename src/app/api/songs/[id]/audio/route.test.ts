import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import {
  __resetObjectStoreForTesting,
  __setObjectStoreForTesting,
  type GetResult,
  type ObjectStore,
} from "@/lib/storage";
import { validMp3Bytes } from "@/lib/test/audio-fixtures";

const AUDIO_BYTES = validMp3Bytes();
const STORAGE_KEY = "songs/opaque/audio-master.mp3";

let nextAuth: ResolvedRequestAuth = ownerAuth();
let nextSong: Record<string, unknown> | null = ownedSong();
let nextStoredObject: GetResult | null = storedAudio();

const getSongByIdForUserMock = mock(async () => nextSong);
const getObjectMock = mock(async () => nextStoredObject);
const objectUrlMock = mock(() => {
  throw new Error("audio delivery must not expose a raw object-store URL");
});

const objectStore: ObjectStore = {
  driver: "memory",
  put: async () => {
    throw new Error("put should not be called");
  },
  get: getObjectMock,
  delete: async () => {
    throw new Error("delete should not be called");
  },
  url: objectUrlMock,
};

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/songs", () => ({
  createSong: mock(async () => null),
  createSongWithSpend: mock(async () => null),
  deleteSong: mock(async () => false),
  deleteSongForUser: mock(async () => null),
  getPublicSongByShareCode: mock(async () => null),
  getPublicSongMetadataByShareCode: mock(async () => null),
  getPublicSongSummaries: mock(async () => []),
  getSongById: mock(async () => null),
  getSongByIdForUser: getSongByIdForUserMock,
  getSongByShareCode: mock(async () => null),
  getSongShareMetaByShareCode: mock(async () => null),
  getSongSummariesByUser: mock(async () => []),
  getSongSummaryByIdForUser: mock(async () => null),
  publishSongShareForUser: mock(async () => null),
  revokeSongShareForUser: mock(async () => null),
  updateSong: mock(async () => null),
  updateSongForUser: mock(async () => null),
}));

const { GET, HEAD } = await import("./route");

beforeEach(() => {
  nextAuth = ownerAuth();
  nextSong = ownedSong();
  nextStoredObject = storedAudio();
  getSongByIdForUserMock.mockClear();
  getObjectMock.mockClear();
  objectUrlMock.mockClear();
  __setObjectStoreForTesting(objectStore);
});

afterEach(() => {
  __resetObjectStoreForTesting();
});

describe("/api/songs/[id]/audio", () => {
  it("scopes GET to the authenticated owner and streams through the storage boundary", async () => {
    const response = await GET(request("GET"), context());

    expect(response.status).toBe(200);
    expect(getSongByIdForUserMock).toHaveBeenCalledWith("song_owner", "usr_owner");
    expect(getObjectMock).toHaveBeenCalledWith(STORAGE_KEY);
    expect(objectUrlMock).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Length")).toBe(String(AUDIO_BYTES.byteLength));
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("X-Murmur-Audio-Source")).toBe("object");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...AUDIO_BYTES]);
  });

  it("does not query or read storage when authentication fails", async () => {
    nextAuth = {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    };

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(401);
    expect(getSongByIdForUserMock).not.toHaveBeenCalled();
    expect(getObjectMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the owner-scoped lookup cannot see the song", async () => {
    nextSong = null;

    const response = await GET(request("GET"), context("song_other"));

    expect(response.status).toBe(404);
    expect(getSongByIdForUserMock).toHaveBeenCalledWith("song_other", "usr_owner");
    expect(getObjectMock).not.toHaveBeenCalled();
  });

  it("supports HEAD without returning the audio body", async () => {
    const response = await HEAD(request("HEAD"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe(String(AUDIO_BYTES.byteLength));
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("serves a single byte range for media playback", async () => {
    const response = await GET(request("GET", { range: "bytes=2-5" }), context());

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 2-5/${AUDIO_BYTES.byteLength}`);
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(AUDIO_BYTES.slice(2, 6));
  });

  it("marks download responses as attachments", async () => {
    const response = await GET(
      request("GET", {}, "https://murmur.example/api/songs/song_owner/audio?download=1"),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toStartWith("attachment;");
    expect(response.headers.get("Content-Disposition")).toContain("Owned-Song.mp3");
  });

  it("returns 410 when the durable audio reference no longer resolves", async () => {
    nextStoredObject = null;

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(objectUrlMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: "audio_missing" });
  });
});

function request(
  method: "GET" | "HEAD",
  headers: Record<string, string> = {},
  url = "https://murmur.example/api/songs/song_owner/audio",
): NextRequest {
  return new Request(url, {
    method,
    headers: {
      "x-request-id": "req_owner_audio",
      ...headers,
    },
  }) as unknown as NextRequest;
}

function context(id = "song_owner") {
  return { params: Promise.resolve({ id }) };
}

function ownerAuth(): ResolvedRequestAuth {
  return {
    ok: true,
    user: { id: "usr_owner", email: null, name: "Owner", avatarUrl: null },
    source: "session",
    sessionId: "sess_owner",
  };
}

function ownedSong(): Record<string, unknown> {
  return {
    id: "song_owner",
    userId: "usr_owner",
    title: "Owned Song",
    mp3StorageKey: STORAGE_KEY,
    mp3Url: "https://storage.invalid/should-never-be-read.mp3",
  };
}

function storedAudio(): GetResult {
  return {
    body: AUDIO_BYTES,
    contentType: "audio/mpeg",
    size: AUDIO_BYTES.byteLength,
    scope: "private",
    meta: {},
    storedAt: new Date("2026-07-30T00:00:00.000Z"),
  };
}
