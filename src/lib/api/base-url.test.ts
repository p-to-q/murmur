import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const ENV_KEY = "NEXT_PUBLIC_MURMUR_API_BASE_URL";

type CapacitorMarker = { isNativePlatform?: () => boolean } | undefined;

async function loadFreshModule() {
  const path = `@/lib/api/base-url?test=${Math.random().toString(36).slice(2)}`;
  return (await import(/* @vite-ignore */ path)) as typeof import("./base-url");
}

function withEnv(value: string | undefined): () => void {
  const original = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  return () => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  };
}

function withCapacitor(value: CapacitorMarker): () => void {
  const candidate = globalThis as { Capacitor?: CapacitorMarker };
  const original = candidate.Capacitor;
  if (value === undefined) delete candidate.Capacitor;
  else candidate.Capacitor = value;
  return () => {
    if (original === undefined) delete candidate.Capacitor;
    else candidate.Capacitor = original;
  };
}

describe("apiBaseUrl / resolveApiUrl", () => {
  let warnSpy: { restore: () => void; calls: unknown[][] };

  beforeEach(() => {
    const original = console.warn;
    const calls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };
    warnSpy = {
      calls,
      restore: () => {
        console.warn = original;
      },
    };
  });

  afterEach(() => {
    warnSpy.restore();
  });

  it("returns an empty base when the env var is unset and not in Capacitor", async () => {
    const restoreEnv = withEnv(undefined);
    const restoreCap = withCapacitor(undefined);
    try {
      const mod = await loadFreshModule();
      mod.__resetCapacitorWarningForTesting();
      expect(mod.apiBaseUrl()).toBe("");
      expect(mod.resolveApiUrl("/api/transcribe")).toBe("/api/transcribe");
      expect(warnSpy.calls.length).toBe(0);
    } finally {
      restoreCap();
      restoreEnv();
    }
  });

  it("prefixes the env URL onto relative paths and strips a trailing slash", async () => {
    const restoreEnv = withEnv("https://api.murmur.app/");
    try {
      const mod = await loadFreshModule();
      mod.__resetCapacitorWarningForTesting();
      expect(mod.apiBaseUrl()).toBe("https://api.murmur.app");
      expect(mod.resolveApiUrl("/api/transcribe")).toBe(
        "https://api.murmur.app/api/transcribe",
      );
      expect(mod.resolveApiUrl("api/songs")).toBe(
        "https://api.murmur.app/api/songs",
      );
    } finally {
      restoreEnv();
    }
  });

  it("leaves absolute URLs untouched even when a base is configured", async () => {
    const restoreEnv = withEnv("https://api.murmur.app");
    try {
      const mod = await loadFreshModule();
      mod.__resetCapacitorWarningForTesting();
      expect(mod.resolveApiUrl("https://other.example/health")).toBe(
        "https://other.example/health",
      );
    } finally {
      restoreEnv();
    }
  });

  it("warns exactly once when running in Capacitor without a configured base", async () => {
    const restoreEnv = withEnv(undefined);
    const restoreCap = withCapacitor({ isNativePlatform: () => true });
    try {
      const mod = await loadFreshModule();
      mod.__resetCapacitorWarningForTesting();
      expect(mod.apiBaseUrl()).toBe("");
      expect(mod.apiBaseUrl()).toBe("");
      expect(warnSpy.calls.length).toBe(1);
      const message = String(warnSpy.calls[0]?.[0] ?? "");
      expect(message).toContain("NEXT_PUBLIC_MURMUR_API_BASE_URL");
    } finally {
      restoreCap();
      restoreEnv();
    }
  });
});
