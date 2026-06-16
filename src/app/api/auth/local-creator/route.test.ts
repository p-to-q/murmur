import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextToken: string | null = null;
let nextAuth: ResolvedRequestAuth = {
  ok: false,
  response: new Response("unauthorized", { status: 401 }),
};
let createdUsers = 0;
let createdSessions = 0;

mock.module("@/lib/auth", () => ({
  SESSION_COOKIE_NAME: "__murmur_session",
  getSessionToken: () => nextToken,
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/users", () => ({
  createLocalCreatorUser: async () => {
    createdUsers += 1;
    return {
      id: "lc_test",
      email: null,
      name: "Local Creator",
      avatarUrl: null,
      accountKind: "local_creator",
    };
  },
}));

mock.module("@/lib/db/queries/sessions", () => ({
  createSession: async () => {
    createdSessions += 1;
    return {
      sessionId: "ses_test",
      token: "tok_test",
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
    };
  },
}));

mock.module("@/lib/observability/log", () => ({
  log: () => undefined,
}));

const { POST } = await import("./route");

beforeEach(() => {
  nextToken = null;
  nextAuth = {
    ok: false,
    response: new Response("unauthorized", { status: 401 }),
  };
  createdUsers = 0;
  createdSessions = 0;
});

describe("POST /api/auth/local-creator", () => {
  it("returns the existing session identity without creating another Local Creator", async () => {
    nextAuth = {
      ok: true,
      user: {
        id: "lc_existing",
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: "ses_existing",
    };

    const response = await POST(
      new Request("http://test.local/api/auth/local-creator", { method: "POST" }) as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { created?: boolean; user?: { id?: string } };
    expect(body.created).toBe(false);
    expect(body.user?.id).toBe("lc_existing");
    expect(createdUsers).toBe(0);
    expect(createdSessions).toBe(0);
  });

  it("does not create a Local Creator for an already registered session", async () => {
    nextAuth = {
      ok: true,
      user: {
        id: "usr_existing",
        email: "a@example.com",
        name: "A",
        avatarUrl: null,
        accountKind: "registered",
      },
      source: "session",
      sessionId: "ses_user",
    };

    const response = await POST(
      new Request("http://test.local/api/auth/local-creator", { method: "POST" }) as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { created?: boolean; user?: { id?: string } };
    expect(body.created).toBe(false);
    expect(body.user?.id).toBe("usr_existing");
    expect(createdUsers).toBe(0);
    expect(createdSessions).toBe(0);
  });

  it("creates a Local Creator user and sets the Murmur session cookie", async () => {
    const response = await POST(
      new Request("http://test.local/api/auth/local-creator", { method: "POST" }) as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      created?: boolean;
      user?: { id?: string; accountKind?: string };
      sessionId?: string;
    };
    expect(body.created).toBe(true);
    expect(body.user?.id).toBe("lc_test");
    expect(body.user?.accountKind).toBe("local_creator");
    expect(body.sessionId).toBe("ses_test");
    expect(response.headers.get("set-cookie")).toContain("__murmur_session=tok_test");
    expect(createdUsers).toBe(1);
    expect(createdSessions).toBe(1);
  });
});
