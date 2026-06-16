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
let nextSnapshot = {
  lifetimeTopupCents: 2197,
  latestPlanSkuId: "topup_120_notes",
};

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/topup-surface", () => ({
  getTopupSurfaceSnapshot: async () => {
    if (nextSnapshotError) throw nextSnapshotError;
    return nextSnapshot;
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
  nextSnapshot = {
    lifetimeTopupCents: 2197,
    latestPlanSkuId: "topup_120_notes",
  };
});

describe("GET /api/user/topup-surface", () => {
  it("returns the serialized topup surface snapshot", async () => {
    const response = await GET(
      new Request("http://test.local/api/user/topup-surface") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      lifetimeTopupCents: number;
      latestPlanSkuId: string | null;
    };
    expect(body).toEqual({
      lifetimeTopupCents: 2197,
      latestPlanSkuId: "topup_120_notes",
    });
  });

  it("returns 503 when the topup surface query fails", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    nextSnapshotError = new Error("db unavailable");

    const response = await GET(
      new Request("https://murmur.app/api/user/topup-surface") as unknown as NextRequest,
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
      latestPlanSkuId: string | null;
    };
    expect(body).toEqual({
      lifetimeTopupCents: 0,
      latestPlanSkuId: null,
    });
  });

  it("keeps the plan field empty when there is no fixed plan purchase", async () => {
    nextSnapshot = {
      lifetimeTopupCents: 1200,
      latestPlanSkuId: null,
    };

    const response = await GET(
      new Request("http://test.local/api/user/topup-surface") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      lifetimeTopupCents: number;
      latestPlanSkuId: string | null;
    };
    expect(body.latestPlanSkuId).toBeNull();
    expect(body.lifetimeTopupCents).toBe(1200);
  });
});
