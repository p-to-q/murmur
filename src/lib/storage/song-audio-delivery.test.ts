import { afterEach, describe, expect, it } from "bun:test";

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
    await store.put("song-master/usr/song/audio.mp3", new Uint8Array([1, 2, 3, 4]), {
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
      expect([...result.artifact.body]).toEqual([1, 2, 3, 4]);
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
    expect(parseByteRange("bytes=0-1,3-4", 5)).toEqual({ status: "unsatisfiable" });
  });
});
