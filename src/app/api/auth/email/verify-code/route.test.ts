import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest, NextResponse } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: {
    id: "lc_invitee",
    email: null,
    name: "Local Creator",
    avatarUrl: null,
    accountKind: "local_creator",
  },
  source: "session",
  sessionId: "ses_local",
};

let upsertResult: {
  userId: string;
  created: boolean;
  registrationKind: "new_user" | "existing_user";
} = {
  userId: "usr_invitee",
  created: true,
  registrationKind: "new_user",
};

const settleRegistrationShareReferralMock = mock(async () => ({
  ok: true as const,
  referralId: "srf_referral",
  referrer: null,
  invitee: null,
  duplicate: false,
}));

mock.module("@/lib/auth/email/send-verification", () => ({
  isEmailAuthConfigured: () => true,
  verifyCode: async () => ({ ok: true as const }),
}));

mock.module("@/lib/db/queries/users", () => ({
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  upsertOAuthUser: async () => upsertResult,
}));

mock.module("@/lib/db/queries/sessions", () => ({
  createSession: async () => ({
    sessionId: "ses_registered",
    token: "tok_registered",
    expiresAt: new Date("2026-07-01T00:00:00.000Z"),
  }),
}));

mock.module("@/lib/platform/server-auth", () => ({
  SESSION_COOKIE_NAME: "__murmur_session",
  murmurSessionCookieOptions: (expires: Date) => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    expires,
    maxAge: 60,
  }),
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/api/share-referral-server", () => ({
  readShareReferrerFromRequest: () => "usr_referrer",
  clearShareReferralCookie: (response: NextResponse) => {
    response.cookies.set("murmur_ref", "", {
      path: "/",
      maxAge: 0,
      sameSite: "lax",
    });
    return response;
  },
}));

mock.module("@/lib/auth/share-referral-settlement", () => ({
  settleRegistrationShareReferral: settleRegistrationShareReferralMock,
}));

mock.module("@/lib/observability/log", () => ({
  log: mock(() => {}),
}));

const { POST } = await import("./route");

beforeEach(() => {
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
    sessionId: "ses_local",
  };
  upsertResult = {
    userId: "usr_invitee",
    created: true,
    registrationKind: "new_user",
  };
  settleRegistrationShareReferralMock.mockClear();
});

function request(): NextRequest {
  return new Request("https://murmur.example/api/auth/email/verify-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "murmur_ref=usr_referrer",
    },
    body: JSON.stringify({
      email: "Invitee@Example.com",
      code: "123456",
    }),
  }) as unknown as NextRequest;
}

describe("POST /api/auth/email/verify-code referral settlement", () => {
  it("settles share referral rewards after a new email registration", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(settleRegistrationShareReferralMock).toHaveBeenCalledWith({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
      registrationKind: "new_user",
      source: "email",
      route: "/api/auth/email/verify-code",
      sessionId: "ses_registered",
      metadata: {
        provider: "email",
      },
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__murmur_session=tok_registered");
    expect(setCookie).toContain("murmur_ref=");
  });

  it("passes existing-user registration state through without upgrading it", async () => {
    upsertResult = {
      userId: "usr_existing",
      created: false,
      registrationKind: "existing_user",
    };

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(settleRegistrationShareReferralMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteeId: "usr_existing",
        registrationKind: "existing_user",
      }),
    );
  });
});
