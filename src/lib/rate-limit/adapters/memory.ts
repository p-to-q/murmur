import { decideHit } from "../token-bucket";
import {
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitState,
  type RateLimitStore,
} from "../types";

/**
 * Process-local token-bucket store. Suitable for dev, tests, and
 * single-instance prod runs. NOT safe across multiple Node/Bun
 * processes — for that, use the redis adapter (TODO) which atomically
 * mutates state via Lua/EVAL.
 *
 * Concurrency: single-threaded execution model means consecutive
 * `hit()` calls are observably serial. No locks needed.
 */
export function createMemoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, RateLimitState>();

  return {
    driver: "memory",

    async hit(key: string, opts: RateLimitOptions, now?: Date): Promise<RateLimitResult> {
      const nowMs = (now ?? new Date()).getTime();
      const prev = buckets.get(key) ?? null;
      const decision = decideHit(prev, opts, nowMs);
      buckets.set(key, decision.nextState);
      return decision.result;
    },

    async reset(key: string): Promise<void> {
      buckets.delete(key);
    },

    async resetAll(): Promise<void> {
      buckets.clear();
    },
  };
}
