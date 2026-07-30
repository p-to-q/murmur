import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: {
    id: "usr_delete",
    email: "delete@example.com",
    name: "Delete Me",
    avatarUrl: null,
    accountKind: "registered",
  },
  source: "session",
  sessionId: "ses_delete",
};
let nextDeletion:
  | {
      ok: true;
      deletedAt: Date;
      revokedSongs: number;
      revokedSessions: number;
      disabledPushSubscriptions: number;
      purgeAfter: Date;
      alreadyDeleted: boolean;
    }
  | { ok: false; reason: "user_not_found" } = {
  ok: true,
  deletedAt: new Date("2026-06-23T00:00:00.000Z"),
  revokedSongs: 3,
  revokedSessions: 2,
  disabledPushSubscriptions: 4,
  purgeAfter: new Date("2026-07-23T00:00:00.000Z"),
  alreadyDeleted: false,
};
let deletionError: unknown = null;

const requestAccountDeletionMock = mock(async () => {
  if (deletionError) throw deletionError;
  return nextDeletion;
});

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/platform/server-auth", () => ({
  SESSION_COOKIE_NAME: "__murmur_session",
  clearMurmurSessionCookieOptions: () => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  }),
}));

mock.module("@/lib/db/queries/users", () => ({
  requestAccountDeletion: requestAccountDeletionMock,
}));

mock.module("@/lib/observability/log", () => ({
  log: mock(() => undefined),
}));

const { POST } = await import("./route");

function request(cookie = "__murmur_session=tok_delete"): NextRequest {
  return new Request("http://test.local/api/account/delete", {
    method: "POST",
    headers: { cookie },
  }) as unknown as NextRequest;
}

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: {
      id: "usr_delete",
      email: "delete@example.com",
      name: "Delete Me",
      avatarUrl: null,
      accountKind: "registered",
    },
    source: "session",
    sessionId: "ses_delete",
  };
  nextDeletion = {
    ok: true,
    deletedAt: new Date("2026-06-23T00:00:00.000Z"),
    revokedSongs: 3,
    revokedSessions: 2,
    disabledPushSubscriptions: 4,
    purgeAfter: new Date("2026-07-23T00:00:00.000Z"),
    alreadyDeleted: false,
  };
  deletionError = null;
  requestAccountDeletionMock.mockClear();
});

describe("POST /api/account/delete", () => {
  it("soft-deletes a registered account and clears session cookies", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(requestAccountDeletionMock).toHaveBeenCalledWith("usr_delete");

    const body = await response.json() as {
      ok?: boolean;
      deletedAt?: string;
      revokedSongs?: number;
      revokedSessions?: number;
      disabledPushSubscriptions?: number;
      purgeAfter?: string;
    };
    expect(body).toMatchObject({
      ok: true,
      deletedAt: "2026-06-23T00:00:00.000Z",
      revokedSongs: 3,
      revokedSessions: 2,
      disabledPushSubscriptions: 4,
      purgeAfter: "2026-07-23T00:00:00.000Z",
    });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__murmur_session=");
    expect(setCookie).toContain("authjs.session-token=");
    expect(setCookie).toContain("__Secure-authjs.session-token=");
  });

  it("rejects Local Creator sessions before deletion", async () => {
    nextAuth = {
      ok: true,
      user: {
        id: "lc_delete",
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: "ses_local",
    };

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(requestAccountDeletionMock).not.toHaveBeenCalled();
    const body = await response.json() as { error?: string };
    expect(body.error).toBe("registered_account_required");
  });

  it("surfaces deletion infrastructure failures without clearing cookies", async () => {
    deletionError = new Error("db offline");

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.json() as { error?: string };
    expect(body.error).toBe("account_delete_unavailable");
  });
});
