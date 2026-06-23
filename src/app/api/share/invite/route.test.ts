import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
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

let originalAppUrl: string | undefined;
let originalVercelUrl: string | undefined;

beforeEach(() => {
  originalAppUrl = process.env.MURMUR_APP_URL;
  originalVercelUrl = process.env.VERCEL_URL;
  process.env.MURMUR_APP_URL = "https://murmur.example";
  delete process.env.VERCEL_URL;
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

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.MURMUR_APP_URL;
  else process.env.MURMUR_APP_URL = originalAppUrl;
  if (originalVercelUrl === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = originalVercelUrl;
});

describe("GET /api/share/invite", () => {
  it("returns a signed-in user's referral link", async () => {
    const response = await GET(
      new Request("https://api-preview.example/api/share/invite") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { url?: string };
    expect(body.url).toBe("https://murmur.example/?ref=usr_inviter");
  });

  it("uses the request origin when no canonical app URL is configured", async () => {
    delete process.env.MURMUR_APP_URL;
    delete process.env.VERCEL_URL;

    const response = await GET(
      new Request("http://localhost:3000/api/share/invite") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { url?: string };
    expect(body.url).toBe("http://localhost:3000/?ref=usr_inviter");
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
