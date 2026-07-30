import { afterEach, describe, expect, it } from "bun:test";

import { MAX_SONG_AUDIO_BYTES } from "@/lib/audio/file-signature";
import { __setObjectStoreForTesting } from "@/lib/storage";
import { createMemoryStore } from "@/lib/storage/adapters/memory";
import {
  buildSongAudioResponse,
  parseByteRange,
  resolveSongAudioArtifact,
} from "./song-audio-delivery";

describe("song audio delivery", () => {
  afterEach(() => __setObjectStoreForTesting(null));

  it("resolves the storage key before legacy fields", async () => {
    const store = createMemoryStore();
    const bytes = mp3Frame();
    await store.put("song-master/usr/song/audio.mp3", bytes, {
      contentType: "audio/mpeg",
      scope: "private",
    });
    __setObjectStoreForTesting(store);

    const result = await resolveSongAudioArtifact({
      mp3StorageKey: "song-master/usr/song/audio.mp3",
      mp3DataUrl: "data:audio/mpeg;base64,CQ==",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.artifact.body).toEqual(bytes);
      expect(result.artifact.source).toBe("object");
    }
  });

  it("returns missing instead of hiding a broken durable key behind stale data", async () => {
    __setObjectStoreForTesting(createMemoryStore());
    const result = await resolveSongAudioArtifact({
      mp3StorageKey: "song-master/usr/song/missing.mp3",
      mp3DataUrl: "data:audio/mpeg;base64,CQ==",
    });
    expect(result.status).toBe("missing");
  });

  it("serves byte ranges and download metadata", async () => {
    const artifact = {
      body: new Uint8Array([0, 1, 2, 3, 4]),
      contentType: "audio/mpeg",
      size: 5,
      digest: "a".repeat(64),
      source: "object" as const,
    };
    const response = buildSongAudioResponse({
      request: new Request("https://murmur.test/audio?download=1", {
        headers: { Range: "bytes=1-3" },
      }),
      artifact,
      title: "My Song",
      requestId: "req_audio",
      cacheControl: "private, no-store",
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 1-3/5");
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("ignores Range for HEAD and returns full representation metadata", async () => {
    const response = buildResponse(new Request("https://murmur.test/audio", {
      method: "HEAD",
      headers: { Range: "bytes=1-3" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Range")).toBeNull();
    expect(response.headers.get("Content-Length")).toBe("5");
    expect(await response.arrayBuffer()).toHaveLength(0);
  });

  it("evaluates If-None-Match before Range, including weak and list matches", () => {
    for (const value of [
      `"other", "sha256-${"a".repeat(64)}"`,
      `W/"sha256-${"a".repeat(64)}"`,
      "*",
    ]) {
      const response = buildResponse(new Request("https://murmur.test/audio", {
        headers: { Range: "bytes=1-3", "If-None-Match": value },
      }));
      expect(response.status).toBe(304);
      expect(response.headers.get("Content-Range")).toBeNull();
    }
  });

  it("honors Range only for a strong matching If-Range validator", async () => {
    const etag = `"sha256-${"a".repeat(64)}"`;
    const matching = buildResponse(new Request("https://murmur.test/audio", {
      headers: { Range: "bytes=1-3", "If-Range": etag },
    }));
    expect(matching.status).toBe(206);
    expect([...new Uint8Array(await matching.arrayBuffer())]).toEqual([1, 2, 3]);

    for (const value of [`W/${etag}`, '"different"', "Wed, 21 Oct 2015 07:28:00 GMT"]) {
      const response = buildResponse(new Request("https://murmur.test/audio", {
        headers: { Range: "bytes=1-3", "If-Range": value },
      }));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Range")).toBeNull();
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it("ignores unsupported multi-ranges instead of reporting the full object unsatisfiable", async () => {
    const response = buildResponse(new Request("https://murmur.test/audio", {
      headers: { Range: "bytes=0-1,3-4" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Range")).toBeNull();
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3, 4]);
  });

  it("streams full responses without changing their bytes", async () => {
    const body = new Uint8Array(130_000);
    for (let index = 0; index < body.length; index += 1) body[index] = index % 251;
    const response = buildSongAudioResponse({
      request: new Request("https://murmur.test/audio"),
      artifact: {
        body,
        contentType: "audio/mpeg",
        size: body.byteLength,
        digest: "b".repeat(64),
        source: "object",
      },
      title: "Streamed Song",
      requestId: "req_stream",
      cacheControl: "private, no-store",
    });

    expect(response.body).not.toBeNull();
    expect(response.headers.get("Content-Length")).toBe(String(body.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
  });

  it("handles suffix, open-ended, and invalid ranges", () => {
    expect(parseByteRange("bytes=-2", 5)).toEqual({ status: "partial", start: 3, end: 4 });
    expect(parseByteRange("bytes=2-", 5)).toEqual({ status: "partial", start: 2, end: 4 });
    expect(parseByteRange("bytes=8-9", 5)).toEqual({ status: "unsatisfiable" });
    expect(parseByteRange("bytes=0-1,3-4", 5)).toBeNull();
    expect(parseByteRange("items=0-1", 5)).toBeNull();
    expect(parseByteRange("bytes=-0", 5)).toBeNull();
    expect(parseByteRange("bytes=3-2", 5)).toBeNull();
    expect(parseByteRange("bytes=-", 5)).toBeNull();
  });

  it("rejects empty, corrupt, oversized, and metadata-inconsistent stored objects", async () => {
    const key = "song-master/usr/song/audio.mp3";
    for (const stored of [
      { body: new Uint8Array(), contentType: "audio/mpeg", size: 0 },
      { body: new TextEncoder().encode("ID3audio"), contentType: "audio/mpeg", size: 8 },
      { body: mp3Frame(), contentType: "audio/wav", size: 417 },
      { body: mp3Frame(), contentType: "audio/mpeg", size: 416 },
      {
        body: new Uint8Array(MAX_SONG_AUDIO_BYTES + 1),
        contentType: "audio/mpeg",
        size: MAX_SONG_AUDIO_BYTES + 1,
      },
    ]) {
      __setObjectStoreForTesting({
        driver: "memory",
        get: async () => ({
          ...stored,
          scope: "private",
          meta: {},
          storedAt: new Date(0),
        }),
        put: async () => { throw new Error("not used"); },
        delete: async () => undefined,
        url: () => "memory://unused",
      });
      expect(await resolveSongAudioArtifact({ mp3StorageKey: key })).toEqual({
        status: "missing",
        storageKey: key,
      });
    }
  });
});

function mp3Frame(): Uint8Array {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return frame;
}

function buildResponse(request: Request): Response {
  return buildSongAudioResponse({
    request,
    artifact: {
      body: new Uint8Array([0, 1, 2, 3, 4]),
      contentType: "audio/mpeg",
      size: 5,
      digest: "a".repeat(64),
      source: "object",
    },
    title: "My Song",
    requestId: "req_audio",
    cacheControl: "private, no-store",
  });
}
