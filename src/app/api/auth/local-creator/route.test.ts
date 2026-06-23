import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { apiRateLimitKey } from "@/lib/api/rate-limit";
import {
  localCreatorFingerprintLimitInput,
  localCreatorIpLimitInput,
} from "@/lib/api/local-creator-rate-limit";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

let nextAuth: ResolvedRequestAuth = {
  ok: false,
  response: new Response("unauthorized", { status: 401 }),
};
let createdUsers = 0;
let createdSessions = 0;
let failNextUserCreation = false;

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

mock.module("@/lib/db/queries/users", () => ({
  createLocalCreatorUser: async () => {
    if (failNextUserCreation) {
      failNextUserCreation = false;
      throw new Error("temporary user store outage");
    }
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

beforeEach(async () => {
  resetCachedRateLimitStore();
  await getRateLimitStore().resetAll();
  nextAuth = {
    ok: false,
    response: new Response("unauthorized", { status: 401 }),
  };
  createdUsers = 0;
  createdSessions = 0;
  failNextUserCreation = false;
});

function buildRequest(headers: HeadersInit = {}): NextRequest {
  return new Request("http://test.local/api/auth/local-creator", {
    method: "POST",
    headers: {
      "x-request-id": "req_local_creator",
      "x-real-ip": "203.0.113.10",
      "user-agent": "Murmur Test Browser",
      ...headers,
    },
  }) as unknown as NextRequest;
}

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

    const request = buildRequest();
    const input = localCreatorFingerprintLimitInput({
      headers: request.headers,
      ip: "203.0.113.10",
      requestId: "req_existing",
    });
    await getRateLimitStore().hit(apiRateLimitKey(input), input.options);

    const response = await POST(request);

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

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    const body = await response.json() as { created?: boolean; user?: { id?: string } };
    expect(body.created).toBe(false);
    expect(body.user?.id).toBe("usr_existing");
    expect(createdUsers).toBe(0);
    expect(createdSessions).toBe(0);
  });

  it("creates a Local Creator user and sets the Murmur session cookie", async () => {
    const response = await POST(buildRequest());

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

  it("creates a Local Creator when the user-agent header is missing", async () => {
    const response = await POST(
      new Request("http://test.local/api/auth/local-creator", {
        method: "POST",
        headers: {
          "x-request-id": "req_missing_user_agent",
          "x-real-ip": "203.0.113.10",
        },
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(createdUsers).toBe(1);
    expect(createdSessions).toBe(1);
  });

  it("rate limits repeated new Local Creator creation for the same IP and browser", async () => {
    const first = await POST(buildRequest({ "x-request-id": "req_first" }));
    const second = await POST(buildRequest({ "x-request-id": "req_second" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    const body = await second.json() as { error?: string; requestId?: string };
    expect(body.error).toBe("rate_limited");
    expect(body.requestId).toBe("req_second");
    expect(second.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(createdUsers).toBe(1);
    expect(createdSessions).toBe(1);
  });

  it("does not consume the daily limit when Local Creator creation fails", async () => {
    failNextUserCreation = true;

    const failed = await POST(buildRequest({ "x-request-id": "req_failed" }));
    const retried = await POST(buildRequest({ "x-request-id": "req_retry" }));
    const repeated = await POST(buildRequest({ "x-request-id": "req_repeated" }));

    expect(failed.status).toBe(503);
    expect(retried.status).toBe(200);
    expect(repeated.status).toBe(429);
    expect(createdUsers).toBe(1);
    expect(createdSessions).toBe(1);
  });

  it("caps the total new Local Creator accounts from one IP per day", async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await POST(
        buildRequest({
          "x-request-id": `req_allowed_${i}`,
          "user-agent": `Murmur Test Browser ${i}`,
        }),
      );
      expect(response.status).toBe(200);
    }

    const blocked = await POST(
      buildRequest({
        "x-request-id": "req_ip_blocked",
        "user-agent": "Murmur Test Browser 11",
      }),
    );

    expect(blocked.status).toBe(429);
    const body = await blocked.json() as { error?: string; requestId?: string };
    expect(body.error).toBe("rate_limited");
    expect(body.requestId).toBe("req_ip_blocked");
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(createdUsers).toBe(10);
    expect(createdSessions).toBe(10);
  });

  it("keeps the IP rate-limit response when fingerprint refund fails", async () => {
    const store = getRateLimitStore();
    const ipLimitInput = localCreatorIpLimitInput({
      ip: "203.0.113.10",
      requestId: "req_prefill_ip_limit",
    });
    if (!ipLimitInput) throw new Error("expected concrete IP rate-limit input");
    await store.hit(apiRateLimitKey(ipLimitInput), {
      ...ipLimitInput.options,
      cost: ipLimitInput.options.capacity,
    });

    const originalRefund = store.refund;
    store.refund = async () => {
      throw new Error("refund store unavailable");
    };

    try {
      const response = await POST(
        buildRequest({
          "x-request-id": "req_ip_blocked_refund_failed",
          "user-agent": "Murmur Refund Failure Browser",
        }),
      );

      expect(response.status).toBe(429);
      const body = await response.json() as { error?: string; requestId?: string };
      expect(body.error).toBe("rate_limited");
      expect(body.requestId).toBe("req_ip_blocked_refund_failed");
      expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(createdUsers).toBe(0);
      expect(createdSessions).toBe(0);
    } finally {
      store.refund = originalRefund;
    }
  });

  it("does not collapse missing IP metadata into a shared daily IP cap", async () => {
    for (let i = 0; i < 11; i += 1) {
      const response = await POST(
        buildRequest({
          "x-real-ip": "",
          "x-request-id": `req_unknown_ip_${i}`,
          "user-agent": `Murmur Unknown IP Browser ${i}`,
        }),
      );
      expect(response.status).toBe(200);
    }

    expect(createdUsers).toBe(11);
    expect(createdSessions).toBe(11);
  });
});
