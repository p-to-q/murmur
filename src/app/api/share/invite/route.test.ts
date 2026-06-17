import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: {
    id: "usr_inviter",
    email: null,
    name: "Inviter",
    avatarUrl: null,
    accountKind: "registered",
  },
  source: "session",
  sessionId: "sess_inviter",
};

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

const { GET } = await import("./route");

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: {
      id: "usr_inviter",
      email: null,
      name: "Inviter",
      avatarUrl: null,
      accountKind: "registered",
    },
    source: "session",
    sessionId: "sess_inviter",
  };
});

describe("GET /api/share/invite", () => {
  it("returns a signed-in user's referral link", async () => {
    const response = await GET(
      new Request("https://murmur.example/api/share/invite") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { url?: string };
    expect(body.url).toBe("https://murmur.example/?ref=usr_inviter");
  });

  it("falls back to a plain share link for Local Creator sessions", async () => {
    nextAuth = {
      ok: true,
      user: {
        id: "lc_inviter",
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: "sess_local",
    };

    const response = await GET(
      new Request("https://murmur.example/api/share/invite") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { url?: string };
    expect(body.url).toBe("https://murmur.example/");
  });

  it("falls back to a plain share link for guests", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Local Creator", avatarUrl: null },
      source: "guest",
      sessionId: null,
    };

    const response = await GET(
      new Request("https://murmur.example/api/share/invite") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { url?: string };
    expect(body.url).toBe("https://murmur.example/");
  });
});
