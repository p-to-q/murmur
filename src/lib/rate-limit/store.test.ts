import { afterEach, describe, expect, it, beforeEach } from "bun:test";
import { setTestNodeEnv } from "@/test-utils/env";

import { createMemoryRateLimitStore } from "./adapters/memory";
import { getRateLimitStore, resetCachedRateLimitStore } from "./index";
import { RateLimitError, type RateLimitDriver, type RateLimitStore } from "./types";

/**
 * Contract test suite. Every adapter passes through here so adding
 * a new backend (redis, postgres) means appending one entry to the
 * adapters list — no behavioural drift between backends.
 */

const adapters: Array<{ name: RateLimitDriver; build: () => RateLimitStore }> = [
  { name: "memory", build: () => createMemoryRateLimitStore() },
];

for (const adapter of adapters) {
  describe(`RateLimitStore contract: ${adapter.name}`, () => {
    let store: RateLimitStore;
    beforeEach(() => {
      store = adapter.build();
    });

    it("identifies its driver", () => {
      expect(store.driver).toBe(adapter.name);
    });

    it("allows the first hit and decrements remaining", async () => {
      const result = await store.hit(
        "user:a",
        { capacity: 3, refillWindowMs: 60_000 },
        new Date(1_000),
      );
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
      expect(result.retryAfterMs).toBe(0);
    });

    it("blocks after capacity is exhausted within the window", async () => {
      const opts = { capacity: 2, refillWindowMs: 60_000 };
      const now = new Date(0);
      await store.hit("user:b", opts, now);
      await store.hit("user:b", opts, now);
      const third = await store.hit("user:b", opts, now);
      expect(third.allowed).toBe(false);
      expect(third.remaining).toBe(0);
      expect(third.retryAfterMs).toBeGreaterThan(0);
    });

    it("isolates buckets by key", async () => {
      const opts = { capacity: 1, refillWindowMs: 60_000 };
      const now = new Date(0);
      const a1 = await store.hit("user:a", opts, now);
      const b1 = await store.hit("user:b", opts, now);
      expect(a1.allowed).toBe(true);
      expect(b1.allowed).toBe(true);
    });

    it("refills the bucket as time passes", async () => {
      const opts = { capacity: 1, refillWindowMs: 1_000 };
      const t0 = new Date(0);
      const first = await store.hit("user:c", opts, t0);
      expect(first.allowed).toBe(true);

      const tooSoon = await store.hit("user:c", opts, new Date(100));
      expect(tooSoon.allowed).toBe(false);

      const afterRefill = await store.hit("user:c", opts, new Date(1_100));
      expect(afterRefill.allowed).toBe(true);
    });

    it("reset(key) restores a single bucket to full capacity", async () => {
      const opts = { capacity: 1, refillWindowMs: 60_000 };
      await store.hit("user:d", opts, new Date(0));
      const blocked = await store.hit("user:d", opts, new Date(0));
      expect(blocked.allowed).toBe(false);

      await store.reset("user:d");
      const fresh = await store.hit("user:d", opts, new Date(0));
      expect(fresh.allowed).toBe(true);
    });

    it("reset(key) does not touch other keys", async () => {
      const opts = { capacity: 1, refillWindowMs: 60_000 };
      await store.hit("user:e", opts, new Date(0));
      await store.hit("user:f", opts, new Date(0));
      await store.reset("user:e");
      const fStill = await store.hit("user:f", opts, new Date(0));
      expect(fStill.allowed).toBe(false);
    });

    it("resetAll clears every bucket", async () => {
      const opts = { capacity: 1, refillWindowMs: 60_000 };
      await store.hit("user:g", opts, new Date(0));
      await store.hit("user:h", opts, new Date(0));
      await store.resetAll();
      const g = await store.hit("user:g", opts, new Date(0));
      const h = await store.hit("user:h", opts, new Date(0));
      expect(g.allowed).toBe(true);
      expect(h.allowed).toBe(true);
    });
  });
}


describe("getRateLimitStore (env-driven factory)", () => {
  let previousDriver: string | undefined;

  beforeEach(() => {
    previousDriver = process.env.MURMUR_RATE_LIMIT_DRIVER;
    resetCachedRateLimitStore();
    delete process.env.MURMUR_RATE_LIMIT_DRIVER;
  });

  afterEach(() => {
    resetCachedRateLimitStore();
    if (previousDriver === undefined) {
      delete process.env.MURMUR_RATE_LIMIT_DRIVER;
    } else {
      process.env.MURMUR_RATE_LIMIT_DRIVER = previousDriver;
    }
  });

  it("defaults to memory when env is unset", () => {
    const store = getRateLimitStore();
    expect(store.driver).toBe("memory");
  });

  it("caches the same store instance across calls", () => {
    const a = getRateLimitStore();
    const b = getRateLimitStore();
    expect(a).toBe(b);
  });

  it("defaults to postgres in production when env is unset", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      setTestNodeEnv("production");
      resetCachedRateLimitStore();
      const store = getRateLimitStore();
      expect(store.driver).toBe("postgres");
    } finally {
      setTestNodeEnv(previousNodeEnv);
      resetCachedRateLimitStore();
    }
  });

  it("uses the postgres adapter when configured", () => {
    process.env.MURMUR_RATE_LIMIT_DRIVER = "postgres";
    const store = getRateLimitStore();
    expect(store.driver).toBe("postgres");
  });

  it("falls back to memory for redis until that adapter lands", () => {
    resetCachedRateLimitStore();
    process.env.MURMUR_RATE_LIMIT_DRIVER = "redis";
    expect(getRateLimitStore().driver).toBe("memory");
  });

  it("throws on unknown driver", () => {
    process.env.MURMUR_RATE_LIMIT_DRIVER = "mongodb";
    expect(() => getRateLimitStore()).toThrow(RateLimitError);
  });
});
