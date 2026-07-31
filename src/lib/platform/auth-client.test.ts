import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  authClient,
  SessionLogoutError,
} from "@/lib/platform/auth-client";
import { createFetchMock } from "@/test-utils/fetch";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("authClient.logout", () => {
  let localStorage: MemoryStorage;

  beforeEach(() => {
    localStorage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage },
    });
    authClient.setUser({
      id: "user-321",
      email: "logout@example.com",
      name: "Logout Test",
    });
    localStorage.setItem("murmur.memory-events", JSON.stringify([{ action: "hum" }]));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("clears local identity only after the logout endpoint succeeds", async () => {
    const requests: Parameters<typeof fetch>[] = [];
    globalThis.fetch = createFetchMock(async (...args) => {
      requests.push(args);
      return new Response(null, { status: 204 });
    });

    const result = await authClient.logout();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.[0]).toBe("/api/auth/logout");
    expect(requests[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
    expect(authClient.user.id).toBe("guest");
    expect(localStorage.getItem("murmur.memory-events")).toBeNull();
    expect(result.serverExitSucceeded).toBe(true);
    expect(result.deviceCleanup.failed.length).toBeGreaterThan(0);
  });

  it("treats HTTP 503 as a failed logout and preserves local identity", async () => {
    globalThis.fetch = createFetchMock(async () =>
      new Response(JSON.stringify({ error: "logout_unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }));

    let caught: unknown;
    try {
      await authClient.logout();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SessionLogoutError);
    expect(caught).toMatchObject({ code: "http_error", status: 503 });
    expect(authClient.user.id).toBe("user-321");
    expect(localStorage.getItem("murmur.local-user")).toContain("user-321");
    expect(localStorage.getItem("murmur.memory-events")).not.toBeNull();
  });

  it("surfaces a network error and preserves local identity", async () => {
    globalThis.fetch = createFetchMock(async () => {
      throw new TypeError("Failed to fetch");
    });

    let caught: unknown;
    try {
      await authClient.logout();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SessionLogoutError);
    expect(caught).toMatchObject({ code: "network_error", status: 0 });
    expect(authClient.user.id).toBe("user-321");
    expect(localStorage.getItem("murmur.local-user")).toContain("user-321");
    expect(localStorage.getItem("murmur.memory-events")).not.toBeNull();
  });
});
