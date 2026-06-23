import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_owner", email: null, name: "Owner", avatarUrl: null },
  source: "session",
  sessionId: "sess_owner",
};

let nextSong: Record<string, unknown> | null = null;
let publishError: unknown = null;
let revokeError: unknown = null;
const getSongByIdForUserMock = mock(async () => nextSong);
const publishSongShareForUserMock = mock(
  async (_songId: string, _userId: string, input: { shareCode: string; visibility?: "unlisted" | "public" }) => {
    if (publishError) throw publishError;
    return {
      ...(nextSong ?? {}),
      shareCode: input.shareCode,
      visibility: input.visibility ?? "unlisted",
    };
  },
);
const revokeSongShareForUserMock = mock(async () => {
  if (revokeError) throw revokeError;
  if (!nextSong) return null;
  return {
    ...nextSong,
    shareCode: null,
    visibility: "private",
  };
});

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/songs", () => ({
  createSong: mock(async () => null),
  createSongWithSpend: mock(async () => null),
  deleteSongForUser: mock(async () => false),
  getPublicSongSummaries: mock(async () => []),
  getSongByIdForUser: getSongByIdForUserMock,
  getSongByShareCode: mock(async () => null),
  getSongSummariesByUser: mock(async () => []),
  publishSongShareForUser: publishSongShareForUserMock,
  revokeSongShareForUser: revokeSongShareForUserMock,
  updateSongForUser: mock(async () => null),
}));

const { DELETE, POST } = await import("./route");

let originalAppUrl: string | undefined;

function request(body: Record<string, unknown> = {}, requestId = "req_share"): NextRequest {
  return new Request("https://murmur.example/api/songs/song_1/share", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function ctx(id = "song_1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  originalAppUrl = process.env.MURMUR_APP_URL;
  process.env.MURMUR_APP_URL = "https://murmur.example";
  resetCachedRateLimitStore();
  await getRateLimitStore().resetAll();
  nextAuth = {
    ok: true,
    user: { id: "usr_owner", email: null, name: "Owner", avatarUrl: null },
    source: "session",
    sessionId: "sess_owner",
  };
  nextSong = {
    id: "song_1",
    userId: "usr_owner",
    title: "Share Me",
    shareCode: null,
    visibility: "private",
    mp3DataUrl: "data:audio/mpeg;base64,abc",
  };
  publishError = null;
  revokeError = null;
  getSongByIdForUserMock.mockClear();
  publishSongShareForUserMock.mockClear();
  revokeSongShareForUserMock.mockClear();
});

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.MURMUR_APP_URL;
  else process.env.MURMUR_APP_URL = originalAppUrl;
});

describe("POST /api/songs/[id]/share", () => {
  it("publishes an owned song as an unlisted share link by default", async () => {
    const response = await POST(
      new Request("https://api-preview.example/api/songs/song_1/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_share",
        },
        body: JSON.stringify({}),
      }) as unknown as NextRequest,
      ctx(),
    );

    expect(response.status).toBe(200);
    expect(getSongByIdForUserMock).toHaveBeenCalledWith("song_1", "usr_owner");
    expect(publishSongShareForUserMock).toHaveBeenCalledTimes(1);
    const body = await response.json() as Record<string, unknown>;
    expect(body.visibility).toBe("unlisted");
    expect(body.shareCode).toMatch(/^[23456789abcdefghijkmnopqrstuvwxyz]{10}$/);
    expect(body.url).toBe(`https://murmur.example/s/${body.shareCode}`);
  });

  it("reuses an existing share code when changing visibility", async () => {
    nextSong = {
      id: "song_1",
      userId: "usr_owner",
      title: "Share Me",
      shareCode: "abc234defg",
      visibility: "unlisted",
      mp3DataUrl: "data:audio/mpeg;base64,abc",
    };

    const response = await POST(request({ visibility: "public" }), ctx());

    expect(response.status).toBe(200);
    expect(publishSongShareForUserMock).toHaveBeenCalledWith(
      "song_1",
      "usr_owner",
      { shareCode: "abc234defg", visibility: "public" },
    );
    const body = await response.json() as Record<string, unknown>;
    expect(body.shareCode).toBe("abc234defg");
    expect(body.visibility).toBe("public");
  });

  it("rejects invalid visibility values", async () => {
    const response = await POST(request({ visibility: "private" }), ctx());

    expect(response.status).toBe(400);
    expect(publishSongShareForUserMock).not.toHaveBeenCalled();
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("validation_error");
  });

  it("rejects and revokes an existing no-audio share link", async () => {
    nextSong = {
      id: "song_1",
      userId: "usr_owner",
      title: "Silent Share",
      shareCode: "abc234defg",
      visibility: "public",
      mp3DataUrl: null,
      mp3Url: null,
    };

    const response = await POST(request(), ctx());

    expect(response.status).toBe(400);
    expect(publishSongShareForUserMock).not.toHaveBeenCalled();
    expect(revokeSongShareForUserMock).toHaveBeenCalledWith("song_1", "usr_owner");
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("audio_required");
  });

  it("does not publish songs the user does not own", async () => {
    nextSong = null;

    const response = await POST(request(), ctx("song_other"));

    expect(response.status).toBe(404);
    expect(publishSongShareForUserMock).not.toHaveBeenCalled();
  });

  it("returns deterministic links for demo songs without DB writes", async () => {
    const response = await POST(request(), ctx("demo-1"));

    expect(response.status).toBe(200);
    expect(getSongByIdForUserMock).not.toHaveBeenCalled();
    expect(publishSongShareForUserMock).not.toHaveBeenCalled();
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      shareCode: "demo-1",
      visibility: "unlisted",
      url: "https://murmur.example/s/demo-1",
    });
  });
});

describe("DELETE /api/songs/[id]/share", () => {
  it("revokes an owned share link and clears the old code", async () => {
    nextSong = {
      id: "song_1",
      userId: "usr_owner",
      title: "Share Me",
      shareCode: "abc234defg",
      visibility: "unlisted",
    };

    const response = await DELETE(
      new Request("https://murmur.example/api/songs/song_1/share", {
        method: "DELETE",
        headers: { "x-request-id": "req_revoke" },
      }) as unknown as NextRequest,
      ctx(),
    );

    expect(response.status).toBe(200);
    expect(revokeSongShareForUserMock).toHaveBeenCalledWith("song_1", "usr_owner");
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      id: "song_1",
      shareCode: null,
      visibility: "private",
    });
  });

  it("does not revoke songs the user does not own", async () => {
    nextSong = null;

    const response = await DELETE(
      new Request("https://murmur.example/api/songs/song_other/share", {
        method: "DELETE",
        headers: { "x-request-id": "req_revoke_other" },
      }) as unknown as NextRequest,
      ctx("song_other"),
    );

    expect(response.status).toBe(404);
    expect(revokeSongShareForUserMock).toHaveBeenCalledWith("song_other", "usr_owner");
  });

  it("does not revoke deterministic demo shares", async () => {
    const response = await DELETE(
      new Request("https://murmur.example/api/songs/demo-1/share", {
        method: "DELETE",
        headers: { "x-request-id": "req_revoke_demo" },
      }) as unknown as NextRequest,
      ctx("demo-1"),
    );

    expect(response.status).toBe(404);
    expect(revokeSongShareForUserMock).not.toHaveBeenCalled();
  });
});
