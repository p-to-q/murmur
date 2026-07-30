import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";

let nextAuth: ResolvedRequestAuth;
let subscribeError: unknown = null;
let unsubscribeError: unknown = null;

const subscribeDeviceMock = mock(async () => {
  if (subscribeError) throw subscribeError;
  return {
    id: "push_sub_1",
    endpoint: "https://push.example.test/subscription/1",
  };
});
const unsubscribeDeviceMock = mock(async () => {
  if (unsubscribeError) throw unsubscribeError;
});

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/platform/notifications-server", () => ({
  notifications: {
    subscribeDevice: subscribeDeviceMock,
    unsubscribeDevice: unsubscribeDeviceMock,
  },
  safeEndpointHost: (endpoint: string) => new URL(endpoint).host,
}));

const { DELETE, POST } = await import("./route");

function request(method: "POST" | "DELETE", body: unknown): NextRequest {
  return new Request("http://test.local/api/notifications/push/subscribe", {
    method,
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_push_subscribe",
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const validSubscription = {
  endpoint: "https://push.example.test/subscription/1",
  keys: { p256dh: "p256dh", auth: "auth" },
};

beforeEach(async () => {
  nextAuth = {
    ok: true,
    user: { id: "usr_push", email: null, name: "Push User", avatarUrl: null },
    source: "session",
    sessionId: "sess_push",
  };
  subscribeError = null;
  unsubscribeError = null;
  subscribeDeviceMock.mockClear();
  unsubscribeDeviceMock.mockClear();
  resetCachedRateLimitStore();
  await getRateLimitStore().resetAll();
});

describe("/api/notifications/push/subscribe request ids", () => {
  it("echoes the request id on subscribe success and validation errors", async () => {
    const success = await POST(request("POST", { subscription: validSubscription }));
    expect(success.status).toBe(200);
    expect(success.headers.get("X-Request-Id")).toBe("req_push_subscribe");

    const invalid = await POST(request("POST", { subscription: { endpoint: "http://invalid" } }));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("X-Request-Id")).toBe("req_push_subscribe");
  });

  it("echoes the request id on subscribe failures and rate limits", async () => {
    subscribeError = new Error("subscribe failed");
    const failed = await POST(request("POST", { subscription: validSubscription }));
    expect(failed.status).toBe(500);
    expect(failed.headers.get("X-Request-Id")).toBe("req_push_subscribe");

    subscribeError = null;
    for (let index = 0; index < 19; index += 1) {
      await POST(request("POST", { subscription: validSubscription }));
    }
    const limited = await POST(request("POST", { subscription: validSubscription }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("X-Request-Id")).toBe("req_push_subscribe");
  });

  it("echoes the request id on unsubscribe success and failures", async () => {
    const success = await DELETE(request("DELETE", { endpoint: validSubscription.endpoint }));
    expect(success.status).toBe(200);
    expect(success.headers.get("X-Request-Id")).toBe("req_push_subscribe");

    unsubscribeError = new Error("unsubscribe failed");
    const failed = await DELETE(request("DELETE", { endpoint: validSubscription.endpoint }));
    expect(failed.status).toBe(500);
    expect(failed.headers.get("X-Request-Id")).toBe("req_push_subscribe");

    const invalid = await DELETE(request("DELETE", { endpoint: "http://invalid" }));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("X-Request-Id")).toBe("req_push_subscribe");
  });

  it("echoes the request id on auth failures", async () => {
    nextAuth = {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    };

    const postResponse = await POST(request("POST", { subscription: validSubscription }));
    expect(postResponse.status).toBe(401);
    expect(postResponse.headers.get("X-Request-Id")).toBe("req_push_subscribe");

    const deleteResponse = await DELETE(request("DELETE", { endpoint: validSubscription.endpoint }));
    expect(deleteResponse.status).toBe(401);
    expect(deleteResponse.headers.get("X-Request-Id")).toBe("req_push_subscribe");
  });

  it("fails closed when the identity has no persistent device session", async () => {
    nextAuth = {
      ok: true,
      user: { id: "usr_authjs", email: null, name: "Auth.js User", avatarUrl: null },
      source: "session",
      sessionId: null,
    };

    const response = await POST(request("POST", { subscription: validSubscription }));

    expect(response.status).toBe(409);
    expect(response.headers.get("X-Request-Id")).toBe("req_push_subscribe");
    expect(await response.json()).toEqual({
      error: "persistent_session_required",
      message: "Push notifications require an active device session.",
    });
    expect(subscribeDeviceMock).not.toHaveBeenCalled();
  });
});
