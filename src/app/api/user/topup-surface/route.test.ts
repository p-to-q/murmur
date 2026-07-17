import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import { setTestNodeEnv } from "@/test-utils/env";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_surface", email: "surface@test.local", name: "Surface User", avatarUrl: null },
  source: "session",
  sessionId: "sess_surface",
};
let nextSnapshotError: unknown = null;
let nextSnapshot: {
  lifetimeTopupCents: number;
  latestPlanSkuId: string | null;
  balanceHistory: Array<{
    range: "1H" | "1D" | "7D" | "1M" | "All";
    points: Array<{ timestamp: string; balance: number }>;
    changeValue: number;
    changePercent: number;
  }>;
  notesInUse: number;
} = {
  lifetimeTopupCents: 2197,
  latestPlanSkuId: "topup_120_notes",
  balanceHistory: [{
    range: "1D",
    points: [
      { timestamp: "2026-07-16T00:00:00.000Z", balance: 10 },
      { timestamp: "2026-07-17T00:00:00.000Z", balance: 14 },
    ],
    changeValue: 4,
    changePercent: 40,
  }],
  notesInUse: 9,
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
let originalProductionPreview: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
  originalDevBillingFallback = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
  originalProductionPreview = process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
  delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
});

afterEach(() => {
  setTestNodeEnv(originalNodeEnv);
  if (originalDevBillingFallback === undefined) {
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
  } else {
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = originalDevBillingFallback;
  }
  if (originalProductionPreview === undefined) {
    delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
  } else {
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = originalProductionPreview;
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
    balanceHistory: [{
      range: "1D",
      points: [
        { timestamp: "2026-07-16T00:00:00.000Z", balance: 10 },
        { timestamp: "2026-07-17T00:00:00.000Z", balance: 14 },
      ],
      changeValue: 4,
      changePercent: 40,
    }],
    notesInUse: 9,
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
      balanceHistory: unknown[];
      notesInUse: number;
    };
    expect(body).toEqual({
      lifetimeTopupCents: 2197,
      latestPlanSkuId: "topup_120_notes",
      balanceHistory: [{
        range: "1D",
        points: [
          { timestamp: "2026-07-16T00:00:00.000Z", balance: 10 },
          { timestamp: "2026-07-17T00:00:00.000Z", balance: 14 },
        ],
        changeValue: 4,
        changePercent: 40,
      }],
      notesInUse: 9,
    });
  });

  it("returns 503 when the topup surface query fails", async () => {
    setTestNodeEnv("production");
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    nextSnapshotError = new Error("db unavailable");

    const response = await GET(
      new Request("https://murmur.app/api/user/topup-surface") as unknown as NextRequest,
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("topup_surface_unavailable");
  });

  it("keeps explicitly enabled production previews usable when the surface query fails", async () => {
    setTestNodeEnv("production");
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = "1";
    nextSnapshotError = new Error("db unavailable");

    const response = await GET(
      new Request("https://preview.example/api/user/topup-surface") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      lifetimeTopupCents: number;
      latestPlanSkuId: string | null;
      balanceHistory: unknown[];
      notesInUse: number;
    };
    expect(body).toEqual({
      lifetimeTopupCents: 0,
      latestPlanSkuId: null,
      balanceHistory: [],
      notesInUse: 0,
    });
  });

  it("keeps the plan field empty when there is no fixed plan purchase", async () => {
    nextSnapshot = {
      lifetimeTopupCents: 1200,
      latestPlanSkuId: null,
      balanceHistory: [],
      notesInUse: 0,
    };

    const response = await GET(
      new Request("http://test.local/api/user/topup-surface") as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      lifetimeTopupCents: number;
      latestPlanSkuId: string | null;
      balanceHistory: unknown[];
      notesInUse: number;
    };
    expect(body.latestPlanSkuId).toBeNull();
    expect(body.lifetimeTopupCents).toBe(1200);
    expect(body.balanceHistory).toEqual([]);
    expect(body.notesInUse).toBe(0);
  });
});
