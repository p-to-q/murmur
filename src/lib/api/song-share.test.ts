import { afterEach, describe, expect, it, mock } from "bun:test";

import {
  createSongShareLink,
  SongShareRequestError,
} from "./song-share";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

describe("createSongShareLink", () => {
  it("creates an unlisted share link through the song share route", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(
        {
          shareCode: "abc234defg",
          visibility: "unlisted",
          url: "https://murmur.example/s/abc234defg",
        },
        200,
        { "X-Request-Id": "req_share" },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createSongShareLink({ songId: "song_1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/songs/song_1/share",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ visibility: "unlisted" }),
      }),
    );
    expect(result).toEqual({
      shareCode: "abc234defg",
      visibility: "unlisted",
      url: "https://murmur.example/s/abc234defg",
      requestId: "req_share",
    });
  });

  it("maps a schema-unavailable server response to a typed error", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(
        {
          error: "schema_unavailable",
          message: "Run migrations",
          requestId: "req_schema",
        },
        503,
      ),
    ) as unknown as typeof fetch;

    await expect(createSongShareLink({ songId: "song_1" })).rejects.toMatchObject({
      name: "SongShareRequestError",
      code: "schema_unavailable",
      status: 503,
      requestId: "req_schema",
    });
  });

  it("turns empty 500 responses into server_error", async () => {
    globalThis.fetch = mock(async () =>
      new Response(null, {
        status: 500,
        headers: { "X-Request-Id": "req_empty_500" },
      }),
    ) as unknown as typeof fetch;

    try {
      await createSongShareLink({ songId: "song_1" });
      throw new Error("expected createSongShareLink to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SongShareRequestError);
      expect((error as SongShareRequestError).code).toBe("server_error");
      expect((error as SongShareRequestError).requestId).toBe("req_empty_500");
    }
  });

  it("maps network failures to network_error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    await expect(createSongShareLink({ songId: "song_1" })).rejects.toMatchObject({
      code: "network_error",
      status: 0,
    });
  });
});
