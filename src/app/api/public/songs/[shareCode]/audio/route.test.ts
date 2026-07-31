import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

import {
  __resetObjectStoreForTesting,
  __setObjectStoreForTesting,
  type GetResult,
  type ObjectStore,
} from "@/lib/storage";
import { validMp3Bytes } from "@/lib/test/audio-fixtures";

const AUDIO_BYTES = validMp3Bytes(9);
const STORAGE_KEY = "songs/opaque/shared-audio-master.mp3";

let nextSong: Record<string, unknown> | null = activeSharedSong();
let nextStoredObject: GetResult | null = storedAudio();

const getPublicSongByShareCodeMock = mock(async () => nextSong);
const getObjectMock = mock(async () => nextStoredObject);
const objectUrlMock = mock(() => {
  throw new Error("public audio delivery must not expose a raw object-store URL");
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

mock.module("@/lib/db/queries/songs", () => ({
  createSong: mock(async () => null),
  createSongWithSpend: mock(async () => null),
  deleteSong: mock(async () => false),
  deleteSongForUser: mock(async () => null),
  getPublicSongByShareCode: getPublicSongByShareCodeMock,
  getPublicSongMetadataByShareCode: mock(async () => null),
  getPublicSongSummaries: mock(async () => []),
  getSongById: mock(async () => null),
  getSongByIdForUser: mock(async () => null),
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
  nextSong = activeSharedSong();
  nextStoredObject = storedAudio();
  getPublicSongByShareCodeMock.mockClear();
  getObjectMock.mockClear();
  objectUrlMock.mockClear();
  __setObjectStoreForTesting(objectStore);
});

afterEach(() => {
  __resetObjectStoreForTesting();
});

describe("/api/public/songs/[shareCode]/audio", () => {
  it("streams an active share without exposing raw storage coordinates", async () => {
    const response = await GET(request("GET"), context());

    expect(response.status).toBe(200);
    expect(getPublicSongByShareCodeMock).toHaveBeenCalledWith("abc234defg");
    expect(getObjectMock).toHaveBeenCalledWith(STORAGE_KEY);
    expect(objectUrlMock).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...AUDIO_BYTES]);
  });

  it("supports HEAD for an active share without returning the body", async () => {
    const response = await HEAD(request("HEAD"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe(String(AUDIO_BYTES.byteLength));
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("supports ranged public playback and attachment downloads", async () => {
    const rangeResponse = await GET(
      request("GET", { range: "bytes=1-3" }),
      context(),
    );

    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get("Content-Range")).toBe(
      `bytes 1-3/${AUDIO_BYTES.byteLength}`,
    );
    expect(new Uint8Array(await rangeResponse.arrayBuffer())).toEqual(AUDIO_BYTES.slice(1, 4));

    const downloadResponse = await GET(
      request(
        "GET",
        {},
        "https://murmur.example/api/public/songs/abc234defg/audio?download=1",
      ),
      context(),
    );

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("Content-Disposition")).toStartWith("attachment;");
    expect(downloadResponse.headers.get("Content-Disposition")).toContain("Shared-Song.mp3");
  });

  it("returns 404 immediately after the share is revoked", async () => {
    nextSong = null;

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(getObjectMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: "not_found" });
  });

  it("returns 410 when an active share points to a missing object", async () => {
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
  url = "https://murmur.example/api/public/songs/abc234defg/audio",
): NextRequest {
  return new Request(url, {
    method,
    headers: {
      "x-request-id": "req_public_audio",
      ...headers,
    },
  }) as unknown as NextRequest;
}

function context(shareCode = "abc234defg") {
  return { params: Promise.resolve({ shareCode }) };
}

function activeSharedSong(): Record<string, unknown> {
  return {
    id: "song_shared",
    title: "Shared Song",
    visibility: "unlisted",
    shareCode: "abc234defg",
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
