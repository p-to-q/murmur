import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const putCalls: Array<{
  key: string;
  body: Uint8Array;
  opts: { contentType: string; scope?: string; meta?: Record<string, string> };
}> = [];

mock.module("@/lib/storage", () => ({
  getObjectStore: () => ({
    driver: "memory",
    put: async (
      key: string,
      body: Uint8Array,
      opts: { contentType: string; scope?: string; meta?: Record<string, string> },
    ) => {
      putCalls.push({ key, body, opts });
      return {
        key,
        url: `https://cdn.example.com/${key}`,
        size: body.byteLength,
        contentType: opts.contentType,
        scope: opts.scope ?? "private",
        storedAt: new Date("2026-06-25T00:00:00Z"),
      };
    },
    get: async () => null,
    delete: async () => undefined,
    url: (key: string) => `https://cdn.example.com/${key}`,
  }),
  objectKey: (input: { userId?: string; songId?: string; id: string; ext: string }) =>
    `songs/master/${input.userId ?? "_shared"}/${input.songId ?? "_"}/${input.id}.${input.ext}`,
}));

const { generateMiniMaxMusic, MiniMaxMusicError } = await import("./minimax-music");

const ENV_KEYS = [
  "MINIMAX_API_KEY",
  "MINIMAX_GROUP_ID",
  "MINIMAX_MUSIC_MODEL",
  "MINIMAX_MUSIC_API_URL",
  "MINIMAX_AUDIO_HOST_ALLOWLIST",
] as const;

let savedEnv: Record<string, string | undefined>;
let originalFetch: typeof fetch;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.MINIMAX_API_KEY = "minimax_key";
  process.env.MINIMAX_GROUP_ID = "group_1";
  process.env.MINIMAX_MUSIC_MODEL = "music-2.6";
  process.env.MINIMAX_MUSIC_API_URL = "https://api.minimax.test/music";
  process.env.MINIMAX_AUDIO_HOST_ALLOWLIST = "audio.minimax.test";
  originalFetch = globalThis.fetch;
  putCalls.length = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("generateMiniMaxMusic", () => {
  it("downloads a MiniMax URL response and stores Murmur's stable URL", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://api.minimax.test/music") {
        return Response.json({
          base_resp: { status_code: 0 },
          status: 2,
          audio_url: "https://audio.minimax.test/song.mp3",
          duration: 18,
        });
      }
      expect(url).toBe("https://audio.minimax.test/song.mp3");
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "audio/mpeg" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateMiniMaxMusic({
      lyrics: "I can sing this line",
      prompt: "warm intimate pop",
      title: "Voice Song",
      userId: "usr_voice",
      songId: "song_voice",
      requestId: "req_1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.opts.scope).toBe("public");
    expect(putCalls[0]?.opts.meta).toEqual({ provider: "minimax", model: "music-2.6" });
    expect(Array.from(putCalls[0]!.body)).toEqual([1, 2, 3]);
    expect(result.mp3Url).toContain("https://cdn.example.com/songs/master/usr_voice/song_voice/");
    expect(result.providerModel).toBe("minimax:music-2.6");
    expect(result.durationSec).toBe(18);
  });

  it("accepts hex audio responses without a download fetch", async () => {
    const hex = "0a".repeat(24);
    const fetchMock = mock(async () =>
      Response.json({
        base_resp: { status_code: 0 },
        data: {
          status: 2,
          audio: hex,
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateMiniMaxMusic({
      lyrics: "I can sing this line",
      prompt: "warm intimate pop",
      userId: "usr_voice",
      songId: "song_hex",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.body.byteLength).toBe(24);
    expect(result.contentType).toBe("audio/mpeg");
  });

  it("fails when MiniMax status is not completed", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        base_resp: { status_code: 0 },
        status: 1,
      }),
    ) as unknown as typeof fetch;

    await expect(
      generateMiniMaxMusic({
        lyrics: "I can sing this line",
        prompt: "warm intimate pop",
        userId: "usr_voice",
        songId: "song_pending",
      }),
    ).rejects.toThrow(MiniMaxMusicError);
  });

  it("fails when MiniMax base_resp reports an error", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        base_resp: { status_code: 1008, status_msg: "insufficient balance" },
        status: 2,
        audio_url: "https://audio.minimax.test/song.mp3",
      }),
    ) as unknown as typeof fetch;

    await expect(
      generateMiniMaxMusic({
        lyrics: "I can sing this line",
        prompt: "warm intimate pop",
        userId: "usr_voice",
        songId: "song_base_error",
      }),
    ).rejects.toThrow(MiniMaxMusicError);
    expect(putCalls).toHaveLength(0);
  });

  it("fails when the provider audio URL cannot be downloaded", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://api.minimax.test/music") {
        return Response.json({
          base_resp: { status_code: 0 },
          status: 2,
          audio_url: "https://audio.minimax.test/expired.mp3",
        });
      }
      return new Response("expired", { status: 403 });
    }) as unknown as typeof fetch;

    await expect(
      generateMiniMaxMusic({
        lyrics: "I can sing this line",
        prompt: "warm intimate pop",
        userId: "usr_voice",
        songId: "song_expired",
      }),
    ).rejects.toThrow(MiniMaxMusicError);
    expect(putCalls).toHaveLength(0);
  });

  it("rejects provider audio URLs from unapproved hosts", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe("https://api.minimax.test/music");
      return Response.json({
        base_resp: { status_code: 0 },
        status: 2,
        audio_url: "https://unexpected.example/song.mp3",
      });
    }) as unknown as typeof fetch;

    await expect(
      generateMiniMaxMusic({
        lyrics: "I can sing this line",
        prompt: "warm intimate pop",
        userId: "usr_voice",
        songId: "song_bad_host",
      }),
    ).rejects.toThrow(MiniMaxMusicError);
    expect(putCalls).toHaveLength(0);
  });

  it("rejects provider audio downloads over the size cap", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://api.minimax.test/music") {
        return Response.json({
          base_resp: { status_code: 0 },
          status: 2,
          audio_url: "https://audio.minimax.test/large.mp3",
        });
      }
      return new Response(null, {
        headers: { "content-length": String(25 * 1024 * 1024) },
      });
    }) as unknown as typeof fetch;

    await expect(
      generateMiniMaxMusic({
        lyrics: "I can sing this line",
        prompt: "warm intimate pop",
        userId: "usr_voice",
        songId: "song_large",
      }),
    ).rejects.toThrow(MiniMaxMusicError);
    expect(putCalls).toHaveLength(0);
  });
});
