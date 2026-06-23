/**
 * Rate-limit substrate, modelled as a token-bucket.
 *
 * Token-bucket vs fixed-window:
 *   Fixed-window (count requests in a calendar window) is simpler but
 *   allows a 2x burst at the window boundary — 10 reqs at 00:59:59
 *   plus 10 reqs at 01:00:00 = 20 reqs in 2 seconds against a
 *   stated "10/min" limit. Token bucket has no such artefact: the
 *   bucket refills continuously, so two bursts back-to-back are
 *   capped by `capacity`, not 2× capacity.
 *
 * Multi-key semantics:
 *   `key` is opaque. Callers compose it: `transcribe:{userId}`,
 *   `webhook:{provider}:{ip}`, `signin:{ip}` — same store, different
 *   key namespaces, never any cross-talk.
 */

export type RateLimitDriver = "memory" | "redis" | "postgres";

export interface RateLimitState {
  /** Current bucket level as a float (sub-token resolution avoids drift). */
  tokens: number;
  /** When the bucket was last touched (ms since epoch). */
  updatedAtMs: number;
}

export interface RateLimitOptions {
  /** Maximum tokens in the bucket. Equivalent to the burst allowance. */
  capacity: number;
  /** How long it takes a fully-empty bucket to refill to capacity. */
  refillWindowMs: number;
  /** Tokens consumed by this request. Defaults to 1. */
  cost?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Configured bucket capacity, echoed so route handlers can emit standard headers. */
  limit: number;
  /** Tokens left in the bucket after this hit (floored to whole tokens for callers/UIs). */
  remaining: number;
  /** When the bucket is projected to refill to `cost` tokens. Always set. */
  retryAt: Date;
  /** 0 when allowed, otherwise ms until `cost` tokens become available. */
  retryAfterMs: number;
}

/**
 * Storage backing a token-bucket limiter. Implementations must make
 * `hit` atomic — concurrent calls for the same key must converge on
 * a consistent token count without losing or double-counting hits.
 * Memory does this by being single-threaded; future Redis/Postgres
 * adapters do this via SETEX+EVAL or SELECT FOR UPDATE.
 */
export interface RateLimitStore {
  readonly driver: RateLimitDriver;
  hit(key: string, opts: RateLimitOptions, now?: Date): Promise<RateLimitResult>;
  /** Refund a successful hit when the protected operation did not complete. */
  refund(key: string, opts: RateLimitOptions, now?: Date): Promise<void>;
  /** Reset a specific bucket. Useful for `/admin/unlock` flows. */
  reset(key: string): Promise<void>;
  /** Drop every bucket. Tests-only; production callers should use `reset(key)`. */
  resetAll(): Promise<void>;
}

export class RateLimitError extends Error {
  constructor(
    readonly code: "invalid_options" | "store_error",
    message: string,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}
