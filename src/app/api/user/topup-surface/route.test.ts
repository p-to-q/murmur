import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_surface", email: "surface@test.local", name: "Surface User", avatarUrl: null },
  source: "session",
  sessionId: "sess_surface",
};
let nextSnapshotError: unknown = null;

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/topup-surface", () => ({
  getTopupSurfaceSnapshot: async () => {
    if (nextSnapshotError) throw nextSnapshotError;
    return {
      lifetimeTopupCents: 2197,
    };
  },
}));

const { GET } = await import("./route");

let originalNodeEnv: string | undefined;
let originalDevBillingFallback: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
  originalDevBillingFallback = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
});

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalDevBillingFallback === undefined) {
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
  } else {
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = originalDevBillingFallback;
  }
  nextAuth = {
    ok: true,
    user: { id: "usr_surface", email: "surface@test.local", name: "Surface User", avatarUrl: null },
    source: "session",
    sessionId: "sess_surface",
  };
  nextSnapshotError = null;
});

describe("GET /api/user/topup-surface", () => {
  it("returns the serialized topup surface snapshot", async () => {
    const response = await GET(
      new Request("http://test.local/api/user/topup-surface") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      lifetimeTopupCents: number;
    };
    expect(body).toEqual({ lifetimeTopupCents: 2197 });
  });

  it("returns 503 when the topup surface query fails", async () => {
    nextSnapshotError = new Error("db unavailable");

    const response = await GET(
      new Request("http://test.local/api/user/topup-surface") as unknown as NextRequest,
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("topup_surface_unavailable");
  });

  it("keeps localhost previews usable when the surface query fails", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    nextSnapshotError = new Error("db unavailable");

    const response = await GET(
      new Request("http://127.0.0.1:3100/api/user/topup-surface") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      lifetimeTopupCents: number;
    };
    expect(body).toEqual({
      lifetimeTopupCents: 0,
    });
  });
});
