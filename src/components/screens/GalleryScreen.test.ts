import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  __resetLocalCreatorBootstrapForTesting,
  hasTriedLocalCreatorBootstrap,
} from "@/lib/auth/local-creator-client";
import { __resetCurrentAccountCacheForTesting } from "@/lib/hooks/use-current-account";
import { __resetUserBalanceCacheForTesting } from "@/lib/hooks/use-user-balance";
import { loadGallerySongsOnce } from "./GalleryScreen";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const BOOTSTRAP_STORAGE_KEY = "murmur.local-creator.bootstrapped";

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

function installBrowserStorage(): MemoryStorage {
  const sessionStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage },
  });
  return sessionStorage;
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

describe("loadGallerySongsOnce", () => {
  let sessionStorage: MemoryStorage;

  beforeEach(() => {
    sessionStorage = installBrowserStorage();
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

  it("uses the existing bootstrap flag for a normal gallery load", async () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, "1");
    const calls: string[] = [];
    globalThis.fetch = (async (input) => {
      calls.push(requestPath(input));
      return jsonResponse([
        { id: "song_ok", title: "Still Here", vibe: "soft", createdAt: "2026-06-20T10:00:00.000Z" },
      ]);
    }) as typeof fetch;

    const songs = await loadGallerySongsOnce();

    expect(songs?.map((song) => song.id)).toEqual(["song_ok"]);
    expect(calls).toEqual(["/api/songs"]);
    expect(hasTriedLocalCreatorBootstrap()).toBe(true);
  });

  it("clears a stale bootstrap flag and retries songs once after 401", async () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, "1");
    let songFetches = 0;
    let bootstrapFetches = 0;
    let clearedBeforeBootstrap = false;

    globalThis.fetch = (async (input, init) => {
      const path = requestPath(input);
      if (path === "/api/songs") {
        songFetches += 1;
        return songFetches === 1
          ? jsonResponse({ error: "unauthorized" }, 401)
          : jsonResponse([
              {
                id: "song_retry",
                title: "Recovered Session",
                vibe: "bright",
                createdAt: "2026-06-20T10:00:00.000Z",
              },
            ]);
      }

      if (path === "/api/auth/local-creator") {
        bootstrapFetches += 1;
        clearedBeforeBootstrap = !hasTriedLocalCreatorBootstrap();
        expect(init?.method).toBe("POST");
        return jsonResponse({
          user: { id: "lc_retry", name: "Local Creator", email: null, avatarUrl: null },
          source: "session",
          sessionId: "sess_retry",
          created: true,
        });
      }

      if (path === "/api/auth/me") {
        return jsonResponse({
          user: {
            id: "lc_retry",
            name: "Local Creator",
            email: null,
            avatarUrl: null,
            accountKind: "local_creator",
          },
          source: "session",
          sessionId: "sess_retry",
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

    const songs = await loadGallerySongsOnce();

    expect(songs?.map((song) => song.id)).toEqual(["song_retry"]);
    expect(songFetches).toBe(2);
    expect(bootstrapFetches).toBe(1);
    expect(clearedBeforeBootstrap).toBe(true);
    expect(hasTriedLocalCreatorBootstrap()).toBe(true);
  });

  it("does not loop when the retried gallery request is still unauthorized", async () => {
    sessionStorage.setItem(BOOTSTRAP_STORAGE_KEY, "1");
    let songFetches = 0;
    let bootstrapFetches = 0;

    globalThis.fetch = (async (input) => {
      const path = requestPath(input);
      if (path === "/api/songs") {
        songFetches += 1;
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      if (path === "/api/auth/local-creator") {
        bootstrapFetches += 1;
        return jsonResponse({
          user: { id: "lc_retry", name: "Local Creator", email: null, avatarUrl: null },
          source: "session",
          sessionId: "sess_retry",
          created: true,
        });
      }
      if (path === "/api/auth/me") {
        return jsonResponse({
          user: { id: "lc_retry", name: "Local Creator", email: null, avatarUrl: null },
          source: "session",
          sessionId: "sess_retry",
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

    const songs = await loadGallerySongsOnce();

    expect(songs).toBeNull();
    expect(songFetches).toBe(2);
    expect(bootstrapFetches).toBe(1);
  });
});
