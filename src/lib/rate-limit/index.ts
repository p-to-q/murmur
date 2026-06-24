import { createMemoryRateLimitStore } from "./adapters/memory";
import {
  type RateLimitDriver,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitStore,
  RateLimitError,
} from "./types";

export {
  type RateLimitDriver,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitState,
  type RateLimitStore,
  RateLimitError,
} from "./types";

export { decideHit } from "./token-bucket";

/**
 * Convenience: hit a store + raise on rejection. Routes that want a
 * 429 response usually look like:
 *
 *   const result = await limiter.hit(`route:${userId}`, { capacity: 10, refillWindowMs: 60_000 });
 *   if (!result.allowed) return new Response("Too Many Requests", {
 *     status: 429,
 *     headers: {
 *       "Retry-After": Math.ceil(result.retryAfterMs / 1000).toString(),
 *       "X-RateLimit-Remaining": result.remaining.toString(),
 *     },
 *   });
 *
 * If you'd rather throw-on-reject, use this helper.
 */
export async function rateLimitOrThrow(
  store: RateLimitStore,
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const result = await store.hit(key, opts);
  if (!result.allowed) {
    const err = new RateLimitError(
      "store_error",
      `rate limit exceeded for key ${key}; retry in ${result.retryAfterMs}ms`,
    );
    Object.assign(err, { result });
    throw err;
  }
  return result;
}

let cachedDefaultStore: RateLimitStore | null = null;

/**
 * Process-default store, chosen by `MURMUR_RATE_LIMIT_DRIVER`.
 *
 * Implemented stores today are memory and postgres. If an older deployment is
 * pre-configured for the planned Redis store, keep public routes alive by
 * falling back to memory; the production env audit blocks that configuration
 * before the next deploy.
 *
 * Most call sites should accept a `RateLimitStore` parameter for
 * testability; only the route-handler edge needs the default.
 */
export function getRateLimitStore(): RateLimitStore {
  if (cachedDefaultStore) return cachedDefaultStore;
  cachedDefaultStore = buildStore(resolveDriverFromEnv());
  return cachedDefaultStore;
}

export function resetCachedRateLimitStore(): void {
  cachedDefaultStore = null;
}

function resolveDriverFromEnv(): RateLimitDriver {
  const raw = process.env.MURMUR_RATE_LIMIT_DRIVER?.trim();
  if (!raw) return process.env.NODE_ENV === "production" ? "postgres" : "memory";
  if (raw === "memory" || raw === "redis" || raw === "postgres") return raw;
  throw new RateLimitError(
    "invalid_options",
    `MURMUR_RATE_LIMIT_DRIVER must be memory|redis|postgres, got "${raw}"`,
  );
}

function buildStore(driver: RateLimitDriver): RateLimitStore {
  switch (driver) {
    case "memory":
      return createMemoryRateLimitStore();
    case "redis":
      warnUnsupportedDriver(driver);
      return createMemoryRateLimitStore();
    case "postgres":
      return createLazyPostgresRateLimitStore();
  }
}

const warnedUnsupportedDrivers = new Set<RateLimitDriver>();

function warnUnsupportedDriver(driver: RateLimitDriver): void {
  if (warnedUnsupportedDrivers.has(driver)) return;
  warnedUnsupportedDrivers.add(driver);
  console.warn(
    `[murmur/rate-limit] ${driver} driver is not implemented yet; using memory rate limits for this process.`,
  );
}

function createLazyPostgresRateLimitStore(): RateLimitStore {
  let storePromise: Promise<RateLimitStore> | null = null;

  async function store(): Promise<RateLimitStore> {
    storePromise ??= import("./adapters/postgres").then((module) =>
      module.createPostgresRateLimitStore(),
    );
    return storePromise;
  }

  return {
    driver: "postgres",
    async hit(key, opts, now) {
      return (await store()).hit(key, opts, now);
    },
    async refund(key, opts, now) {
      return (await store()).refund(key, opts, now);
    },
    async reset(key) {
      return (await store()).reset(key);
    },
    async resetAll() {
      return (await store()).resetAll();
    },
  };
}
