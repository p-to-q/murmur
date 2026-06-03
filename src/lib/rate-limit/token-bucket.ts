import {
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitState,
  RateLimitError,
} from "./types";

/**
 * Pure decision for one token-bucket hit. State in, state out — no
 * timers, no IO. The store wrapper is responsible for persistence
 * and atomicity; everything else lives here so the algorithm can be
 * exercised exhaustively without spinning up a store.
 */
export interface TokenBucketDecision {
  result: RateLimitResult;
  nextState: RateLimitState;
}

export function decideHit(
  prevState: RateLimitState | null,
  opts: RateLimitOptions,
  nowMs: number,
): TokenBucketDecision {
  validateOptions(opts);
  const cost = opts.cost ?? 1;
  const refillPerMs = opts.capacity / opts.refillWindowMs;

  const startingTokens = prevState
    ? Math.min(
        opts.capacity,
        prevState.tokens + Math.max(0, nowMs - prevState.updatedAtMs) * refillPerMs,
      )
    : opts.capacity;

  if (startingTokens >= cost) {
    const tokensAfter = startingTokens - cost;
    const msUntilRefill = refillPerMs > 0 ? (cost - tokensAfter) / refillPerMs : 0;
    return {
      result: {
        allowed: true,
        remaining: Math.floor(tokensAfter),
        retryAt: new Date(nowMs + Math.max(0, Math.ceil(msUntilRefill))),
        retryAfterMs: 0,
      },
      nextState: { tokens: tokensAfter, updatedAtMs: nowMs },
    };
  }

  const tokensNeeded = cost - startingTokens;
  const retryAfterMs = refillPerMs > 0 ? Math.ceil(tokensNeeded / refillPerMs) : Number.POSITIVE_INFINITY;
  return {
    result: {
      allowed: false,
      remaining: Math.max(0, Math.floor(startingTokens)),
      retryAt: new Date(nowMs + retryAfterMs),
      retryAfterMs,
    },
    // We do NOT persist a debit on a rejected hit. The bucket is
    // refilled to `startingTokens` (the post-refill snapshot) so the
    // next caller sees an accurate level. This is the standard
    // token-bucket semantics — rejects don't drain the bucket.
    nextState: { tokens: startingTokens, updatedAtMs: nowMs },
  };
}

function validateOptions(opts: RateLimitOptions): void {
  if (!Number.isFinite(opts.capacity) || opts.capacity <= 0) {
    throw new RateLimitError("invalid_options", "capacity must be a positive number");
  }
  if (!Number.isFinite(opts.refillWindowMs) || opts.refillWindowMs <= 0) {
    throw new RateLimitError("invalid_options", "refillWindowMs must be a positive number");
  }
  if (opts.cost !== undefined && (!Number.isFinite(opts.cost) || opts.cost <= 0)) {
    throw new RateLimitError("invalid_options", "cost must be a positive number when set");
  }
}
