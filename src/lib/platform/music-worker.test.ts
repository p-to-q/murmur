import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getMusicEngineMode,
  getMusicServerlessConfig,
  getMusicWorkerUrl,
  isMusicWorkerConfigured,
} from "@/lib/platform/music-worker";

// The resolver reads process.env at call time; snapshot and restore the keys we
// touch so cases don't leak into each other (or into other suites).
const KEYS = [
  "MUSIC_ENGINE_MODE",
  "RUNPOD_SERVERLESS_ENDPOINT_ID",
  "RUNPOD_API_KEY",
  "MUSIC_WORKER_URL",
  "NODE_ENV",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of KEYS) saved[key] = process.env[key];
  // Start from a clean slate: prod-like (no localhost fallback) and nothing wired.
  for (const key of KEYS) delete process.env[key];
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function wireServerless() {
  process.env.RUNPOD_SERVERLESS_ENDPOINT_ID = "ep_test";
  process.env.RUNPOD_API_KEY = "rpa_test";
}
function wirePod() {
  process.env.MUSIC_WORKER_URL = "https://pod-abc-8002.proxy.runpod.net";
}

describe("getMusicEngineMode transport selection", () => {
  it("is null when nothing is configured", () => {
    expect(getMusicEngineMode()).toBeNull();
    expect(isMusicWorkerConfigured()).toBe(false);
  });

  it("auto (default) prefers serverless when both are configured", () => {
    wireServerless();
    wirePod();
    expect(getMusicEngineMode()).toBe("serverless");
  });

  it("auto falls back to the http pod when only the pod is configured", () => {
    wirePod();
    expect(getMusicEngineMode()).toBe("http");
  });

  it("production keeps serverless canonical even when MUSIC_ENGINE_MODE=http is stale", () => {
    wireServerless();
    wirePod();
    process.env.MUSIC_ENGINE_MODE = "http";
    expect(getMusicEngineMode()).toBe("serverless");
  });

  it("MUSIC_ENGINE_MODE=http can force the pod outside production", () => {
    wireServerless();
    wirePod();
    process.env.NODE_ENV = "development";
    process.env.MUSIC_ENGINE_MODE = "http";
    expect(getMusicEngineMode()).toBe("http");
  });

  it("treats 'pod' and 'worker' as aliases for the http transport", () => {
    wireServerless();
    wirePod();
    process.env.NODE_ENV = "development";
    for (const alias of ["pod", "worker", "HTTP", " Pod "]) {
      process.env.MUSIC_ENGINE_MODE = alias;
      expect(getMusicEngineMode()).toBe("http");
    }
  });

  it("MUSIC_ENGINE_MODE=serverless forces serverless even when a pod is configured", () => {
    wireServerless();
    wirePod();
    process.env.MUSIC_ENGINE_MODE = "serverless";
    expect(getMusicEngineMode()).toBe("serverless");
  });

  it("falls back instead of going dark when the forced transport is missing", () => {
    // Forced to http but only serverless wired → serverless rather than null.
    wireServerless();
    process.env.MUSIC_ENGINE_MODE = "http";
    expect(getMusicEngineMode()).toBe("serverless");

    // Forced to serverless but only the pod wired → http rather than null.
    delete process.env.RUNPOD_SERVERLESS_ENDPOINT_ID;
    delete process.env.RUNPOD_API_KEY;
    wirePod();
    process.env.MUSIC_ENGINE_MODE = "serverless";
    expect(getMusicEngineMode()).toBe("http");
  });

  it("an unrecognized mode behaves like auto", () => {
    wireServerless();
    wirePod();
    process.env.MUSIC_ENGINE_MODE = "banana";
    expect(getMusicEngineMode()).toBe("serverless");
  });

  it("getMusicServerlessConfig needs both endpoint id and api key", () => {
    process.env.RUNPOD_SERVERLESS_ENDPOINT_ID = "ep_test";
    expect(getMusicServerlessConfig()).toBeNull();
    process.env.RUNPOD_API_KEY = "rpa_test";
    expect(getMusicServerlessConfig()).toEqual({ endpointId: "ep_test", apiKey: "rpa_test" });
  });

  it("getMusicWorkerUrl is null in prod when unset (no localhost fallback)", () => {
    expect(getMusicWorkerUrl()).toBeNull();
    process.env.NODE_ENV = "development";
    expect(getMusicWorkerUrl()).toBe("http://127.0.0.1:8002");
  });
});
