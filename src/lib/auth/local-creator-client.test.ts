import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  __resetLocalCreatorBootstrapForTesting,
  ensureLocalCreatorSession,
  hasTriedLocalCreatorBootstrap,
} from "./local-creator-client";
import { __resetCurrentAccountCacheForTesting } from "@/lib/hooks/use-current-account";
import { __resetUserBalanceCacheForTesting } from "@/lib/hooks/use-user-balance";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

function installBrowserStorage(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: new MemoryStorage() },
  });
}

function restoreWindow(): void {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
    return;
  }
  delete (globalThis as { window?: unknown }).window;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return input.url;
}

describe("ensureLocalCreatorSession", () => {
  beforeEach(() => {
    installBrowserStorage();
    __resetLocalCreatorBootstrapForTesting();
    __resetCurrentAccountCacheForTesting();
    __resetUserBalanceCacheForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetLocalCreatorBootstrapForTesting();
    __resetCurrentAccountCacheForTesting();
    __resetUserBalanceCacheForTesting();
    restoreWindow();
  });

  it("returns true only after the account refresh resolves a Local Creator", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input) => {
      const path = requestPath(input);
      calls.push(path);
      if (path === "/api/auth/local-creator") {
        return jsonResponse({ ok: true });
      }
      if (path === "/api/auth/me") {
        return jsonResponse({
          user: {
            id: "lc_ready",
            name: "Local Creator",
            email: null,
            avatarUrl: null,
            accountKind: "local_creator",
          },
          source: "session",
          sessionId: "sess_ready",
          authenticated: true,
          identityProviders: [],
        });
      }
      if (path === "/api/user/balance") {
        return jsonResponse({
          notes: 5,
          accountNotes: 5,
          dailyFreeNotes: 0,
          planTier: "free",
          nextRefillAt: null,
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    }) as typeof fetch;

    await expect(ensureLocalCreatorSession()).resolves.toBe(true);
    expect(calls).toEqual([
      "/api/auth/local-creator",
      "/api/auth/me",
      "/api/user/balance",
    ]);
    expect(hasTriedLocalCreatorBootstrap()).toBe(true);
  });

  it("does not report success when the refreshed account is still guest", async () => {
    globalThis.fetch = (async (input) => {
      const path = requestPath(input);
      if (path === "/api/auth/local-creator") {
        return jsonResponse({ ok: true });
      }
      if (path === "/api/auth/me") {
        return jsonResponse({
          user: {
            id: "guest",
            name: "Local Creator",
            email: null,
            avatarUrl: null,
            accountKind: null,
          },
          source: "guest",
          sessionId: null,
          authenticated: false,
          identityProviders: [],
        });
      }
      if (path === "/api/user/balance") {
        return jsonResponse({
          notes: 5,
          accountNotes: 5,
          dailyFreeNotes: 0,
          planTier: "free",
          nextRefillAt: null,
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    }) as typeof fetch;

    await expect(ensureLocalCreatorSession()).resolves.toBe(false);
    expect(hasTriedLocalCreatorBootstrap()).toBe(true);
  });

  it("clears the bootstrap flag after a rejected Local Creator request", async () => {
    globalThis.fetch = (async (input) => {
      if (requestPath(input) === "/api/auth/local-creator") {
        return jsonResponse({ error: "rate_limited" }, 429);
      }
      throw new Error(`unexpected fetch ${requestPath(input)}`);
    }) as typeof fetch;

    await expect(ensureLocalCreatorSession()).resolves.toBe(false);
    expect(hasTriedLocalCreatorBootstrap()).toBe(false);
  });
});
