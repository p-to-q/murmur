import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import type { ClaimShareReferralResult } from "@/lib/db/queries/share-referrals";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: {
    id: "usr_invitee",
    email: null,
    name: "Invitee",
    avatarUrl: null,
    accountKind: "registered",
  },
  source: "session",
  sessionId: "sess_invitee",
};
const getSettledShareReferralForInviteeMock = mock(async (): Promise<ClaimShareReferralResult> => ({
  ok: true as const,
  referralId: "srf_existing",
  referrer: null,
  invitee: null,
  duplicate: true,
}));

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/share-referrals", () => ({
  normalizeReferralUserId: (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed && /^[A-Za-z0-9_-]{6,128}$/.test(trimmed) ? trimmed : null;
  },
  canUseShareReferral: (user: { id?: string | null; accountKind?: string | null }) =>
    Boolean(user?.id && user.id !== "guest" && user.accountKind === "registered"),
  getSettledShareReferralForInvitee: getSettledShareReferralForInviteeMock,
}));

const { POST } = await import("./route");

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: {
      id: "usr_invitee",
      email: null,
      name: "Invitee",
      avatarUrl: null,
      accountKind: "registered",
    },
    source: "session",
    sessionId: "sess_invitee",
  };
  getSettledShareReferralForInviteeMock.mockClear();
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
  it("confirms an already-settled registration referral", async () => {
    const response = await POST(request({ referrerId: "usr_referrer" }));

    expect(response.status).toBe(200);
    expect(getSettledShareReferralForInviteeMock).toHaveBeenCalledWith({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
    });
    const body = await response.json() as { notesGranted?: unknown; duplicate?: unknown };
    expect(body.notesGranted).toBe(0);
    expect(body.duplicate).toBe(true);
    expect(response.headers.get("set-cookie")).toContain("murmur_ref=");
  });

  it("prefers the referral cookie over the body", async () => {
    const response = await POST(request(
      { referrerId: "usr_body" },
      "murmur_ref=usr_cookie",
    ));

    expect(response.status).toBe(200);
    expect(getSettledShareReferralForInviteeMock).toHaveBeenCalledWith({
      referrerId: "usr_cookie",
      inviteeId: "usr_invitee",
    });
  });

  it("rejects unsettled refs so existing users cannot claim invite credit", async () => {
    getSettledShareReferralForInviteeMock.mockResolvedValueOnce({
      ok: false as const,
      reason: "registration_required" as const,
    });

    const response = await POST(request({ referrerId: "usr_referrer" }));

    expect(response.status).toBe(409);
    const body = await response.json() as { error?: unknown };
    expect(body.error).toBe("registration_required");
    expect(response.headers.get("set-cookie")).toContain("murmur_ref=");
  });

  it("rejects guest claims", async () => {
    nextAuth = {
      ok: true,
      user: {
        id: "guest",
        email: null,
        name: "Guest",
        avatarUrl: null,
      },
      source: "guest",
      sessionId: null,
    };

    const response = await POST(request({ referrerId: "usr_referrer" }));

    expect(response.status).toBe(403);
    expect(getSettledShareReferralForInviteeMock).toHaveBeenCalledTimes(0);
  });

  it("rejects Local Creator claims", async () => {
    nextAuth = {
      ok: true,
      user: {
        id: "lc_invitee",
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: "sess_local",
    };

    const response = await POST(request({ referrerId: "usr_referrer" }));

    expect(response.status).toBe(403);
    expect(getSettledShareReferralForInviteeMock).toHaveBeenCalledTimes(0);
  });
});
