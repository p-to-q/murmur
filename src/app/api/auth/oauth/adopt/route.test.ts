import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedSession } from "@/lib/db/queries/sessions";

type OAuthSessionLike = {
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
    accountKind?: "local_creator" | "registered";
    authProvider?: string;
  };
} | null;

let oauthSession: OAuthSessionLike = null;
let currentSession: ResolvedSession | null = null;
let createdSessions = 0;

mock.module("@/lib/auth/auth", () => ({
  auth: async () => oauthSession,
}));

mock.module("@/lib/db/queries/sessions", () => ({
  getSessionByToken: async () => currentSession,
  createSession: async (input: { userId: string }) => {
    createdSessions += 1;
    return {
      sessionId: `ses_created_${createdSessions}`,
      token: `tok_created_${input.userId}`,
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
    };
  },
}));

mock.module("@/lib/platform/server-auth", () => ({
  SESSION_COOKIE_NAME: "__murmur_session",
  getSessionToken: (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    return cookie.includes("__murmur_session=tok_existing")
      ? "tok_existing"
      : null;
  },
  murmurSessionCookieOptions: (expires: Date) => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    expires,
    maxAge: 60,
  }),
}));

mock.module("@/lib/observability/log", () => ({
  log: mock(() => {}),
}));

const { POST } = await import("./route");

beforeEach(() => {
  oauthSession = null;
  currentSession = null;
  createdSessions = 0;
});

function request(cookie?: string): NextRequest {
  return new Request("https://murmur.example/api/auth/oauth/adopt", {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
  }) as unknown as NextRequest;
}

function registeredOAuthSession(id = "usr_oauth"): OAuthSessionLike {
  return {
    user: {
      id,
      email: "oauth@example.com",
      name: "OAuth User",
      image: "https://example.com/avatar.png",
      accountKind: "registered",
      authProvider: "github",
    },
  };
}

describe("POST /api/auth/oauth/adopt", () => {
  it("rejects requests without a provider session", async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(createdSessions).toBe(0);
  });

  it("reuses an existing registered Murmur session for the same user", async () => {
    oauthSession = registeredOAuthSession("usr_existing");
    currentSession = {
      sessionId: "ses_existing",
      user: {
        id: "usr_existing",
        email: "oauth@example.com",
        name: "OAuth User",
        avatarUrl: null,
        accountKind: "registered",
      },
    };

    const response = await POST(request("__murmur_session=tok_existing"));
    const body = await response.json() as { adopted?: boolean; sessionId?: string };

    expect(response.status).toBe(200);
    expect(body.adopted).toBe(false);
    expect(body.sessionId).toBe("ses_existing");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createdSessions).toBe(0);
  });

  it("creates a Murmur session cookie for a valid OAuth user", async () => {
    oauthSession = registeredOAuthSession("usr_new");

    const response = await POST(request());
    const body = await response.json() as {
      adopted?: boolean;
      sessionId?: string;
      user?: { id?: string; accountKind?: string };
    };

    expect(response.status).toBe(200);
    expect(body.adopted).toBe(true);
    expect(body.sessionId).toBe("ses_created_1");
    expect(body.user?.id).toBe("usr_new");
    expect(body.user?.accountKind).toBe("registered");
    expect(response.headers.get("set-cookie")).toContain(
      "__murmur_session=tok_created_usr_new",
    );
    expect(createdSessions).toBe(1);
  });
});
