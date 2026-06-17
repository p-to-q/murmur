import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_invitee", email: null, name: "Invitee", avatarUrl: null },
  source: "session",
  sessionId: "sess_invitee",
};
const claimShareReferralMock = mock(async () => ({
  ok: true as const,
  referrer: {
    ok: true as const,
    ledgerId: "nle_referrer",
    balanceBefore: 10,
    balanceAfter: 110,
    duplicate: false,
  },
  invitee: {
    ok: true as const,
    ledgerId: "nle_invitee",
    balanceBefore: 15,
    balanceAfter: 115,
    duplicate: false,
  },
  duplicate: false,
}));

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/share-referrals", () => ({
  SHARE_REFERRAL_REWARD_NOTES: 100,
  normalizeReferralUserId: (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed && /^[A-Za-z0-9_-]{6,128}$/.test(trimmed) ? trimmed : null;
  },
  claimShareReferral: claimShareReferralMock,
}));

mock.module("@/lib/observability/log", () => ({
  log: mock(() => {}),
}));

const { POST } = await import("./route");

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: { id: "usr_invitee", email: null, name: "Invitee", avatarUrl: null },
    source: "session",
    sessionId: "sess_invitee",
  };
  claimShareReferralMock.mockClear();
});

function request(body: Record<string, unknown>, cookie?: string): NextRequest {
  return new Request("https://murmur.example/api/share/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/share/claim", () => {
  it("grants referral notes to the referrer and invitee", async () => {
    const response = await POST(request({ referrerId: "usr_referrer" }));

    expect(response.status).toBe(200);
    expect(claimShareReferralMock).toHaveBeenCalledWith({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
    });
    const body = await response.json() as { notesGranted?: unknown };
    expect(body.notesGranted).toBe(100);
  });

  it("prefers the referral cookie over the body", async () => {
    const response = await POST(request(
      { referrerId: "usr_body" },
      "murmur_ref=usr_cookie",
    ));

    expect(response.status).toBe(200);
    expect(claimShareReferralMock).toHaveBeenCalledWith({
      referrerId: "usr_cookie",
      inviteeId: "usr_invitee",
    });
  });

  it("rejects guest claims", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Local Creator", avatarUrl: null },
      source: "guest",
      sessionId: null,
    };

    const response = await POST(request({ referrerId: "usr_referrer" }));

    expect(response.status).toBe(403);
    expect(claimShareReferralMock).toHaveBeenCalledTimes(0);
  });
});
