import { describe, expect, it } from "bun:test";

import { decideHit } from "./token-bucket";
import { RateLimitError, type RateLimitState } from "./types";

describe("decideHit (cold bucket)", () => {
  it("starts at full capacity and allows the first hit", () => {
    const decision = decideHit(null, { capacity: 5, refillWindowMs: 60_000 }, 1000);
    expect(decision.result.allowed).toBe(true);
    expect(decision.result.remaining).toBe(4);
    expect(decision.nextState.tokens).toBe(4);
    expect(decision.nextState.updatedAtMs).toBe(1000);
  });

  it("respects a single-token capacity with cost=1", () => {
    const first = decideHit(null, { capacity: 1, refillWindowMs: 1000 }, 0);
    expect(first.result.allowed).toBe(true);
    expect(first.result.remaining).toBe(0);

    const second = decideHit(first.nextState, { capacity: 1, refillWindowMs: 1000 }, 0);
    expect(second.result.allowed).toBe(false);
    expect(second.result.retryAfterMs).toBe(1000);
  });
});

describe("decideHit (refill semantics)", () => {
  it("refills proportionally to elapsed time", () => {
    const opts = { capacity: 10, refillWindowMs: 10_000 }; // 1 token / sec
    const prev: RateLimitState = { tokens: 0, updatedAtMs: 0 };

    const after3s = decideHit(prev, opts, 3_000);
    expect(after3s.result.allowed).toBe(true);
    // 3 tokens refilled, 1 consumed, 2 remain.
    expect(after3s.result.remaining).toBe(2);
    expect(after3s.nextState.tokens).toBeCloseTo(2, 6);
  });

  it("caps refill at capacity (no overshoot)", () => {
    const opts = { capacity: 5, refillWindowMs: 1_000 };
    const prev: RateLimitState = { tokens: 0, updatedAtMs: 0 };
    // 60 seconds of refill against a 1s window should saturate at 5.
    const decision = decideHit(prev, opts, 60_000);
    expect(decision.result.allowed).toBe(true);
    expect(decision.result.remaining).toBe(4);
    expect(decision.nextState.tokens).toBe(4);
  });

  it("treats a backwards clock as zero elapsed time (defensive)", () => {
    const opts = { capacity: 5, refillWindowMs: 1_000 };
    const prev: RateLimitState = { tokens: 2, updatedAtMs: 5_000 };
    // Now < updatedAtMs — could happen with NTP correction. Don't
    // hand out refill credit for that.
    const decision = decideHit(prev, opts, 4_999);
    expect(decision.result.allowed).toBe(true);
    expect(decision.nextState.tokens).toBeCloseTo(1, 6);
  });
});

describe("decideHit (rejection paths)", () => {
  it("rejects when bucket is empty and no time has elapsed", () => {
    const opts = { capacity: 3, refillWindowMs: 30_000 };
    const prev: RateLimitState = { tokens: 0, updatedAtMs: 1_000 };
    const decision = decideHit(prev, opts, 1_000);

    expect(decision.result.allowed).toBe(false);
    expect(decision.result.remaining).toBe(0);
    expect(decision.result.retryAfterMs).toBe(10_000);
    expect(decision.result.retryAt.getTime()).toBe(11_000);
  });

  it("a rejected hit does not debit the bucket", () => {
    const opts = { capacity: 2, refillWindowMs: 2_000 };
    const prev: RateLimitState = { tokens: 0.5, updatedAtMs: 0 };
    // 0.5 tokens already + 0 elapsed = 0.5 starting tokens, need 1.
    const decision = decideHit(prev, opts, 0);

    expect(decision.result.allowed).toBe(false);
    // Bucket level stays at the post-refill value (0.5), not -0.5.
    expect(decision.nextState.tokens).toBeCloseTo(0.5, 6);
  });

  it("rounds retryAfterMs UP so callers don't poll early", () => {
    const opts = { capacity: 1, refillWindowMs: 1_000 };
    const prev: RateLimitState = { tokens: 0.5, updatedAtMs: 0 };
    // Need 0.5 more tokens; refillPerMs = 0.001; needs 500ms exactly.
    // For a less-clean ratio:
    const opts2 = { capacity: 3, refillWindowMs: 1_000 }; // 0.003 t/ms
    const prev2: RateLimitState = { tokens: 0.5, updatedAtMs: 0 };
    const decision = decideHit(prev2, opts2, 0);
    expect(decision.result.allowed).toBe(false);
    // ceil(0.5 / 0.003) = 167
    expect(decision.result.retryAfterMs).toBe(167);

    // Cleanly: 500ms
    const clean = decideHit(prev, opts, 0);
    expect(clean.result.retryAfterMs).toBe(500);
  });
});

describe("decideHit (cost > 1)", () => {
  it("accepts when bucket has enough for the request cost", () => {
    const opts = { capacity: 10, refillWindowMs: 60_000, cost: 4 };
    const decision = decideHit(null, opts, 0);
    expect(decision.result.allowed).toBe(true);
    expect(decision.result.remaining).toBe(6);
  });

  it("rejects and reports correct retryAfter when cost exceeds tokens", () => {
    const opts = { capacity: 10, refillWindowMs: 10_000, cost: 4 }; // 1 t/sec
    const prev: RateLimitState = { tokens: 1, updatedAtMs: 0 };
    const decision = decideHit(prev, opts, 0);

    expect(decision.result.allowed).toBe(false);
    // Need 3 more tokens at 1 t/sec → 3000ms.
    expect(decision.result.retryAfterMs).toBe(3_000);
  });

  it("rejects on cost > capacity even with a fully-refilled bucket", () => {
    const opts = { capacity: 3, refillWindowMs: 1_000, cost: 10 };
    const decision = decideHit(null, opts, 0);
    expect(decision.result.allowed).toBe(false);
    // 10 needed at 0.003 t/ms = 7 / 0.003 = ceil(2333.33) = 2334
    expect(decision.result.retryAfterMs).toBe(2_334);
  });
});

describe("decideHit (validation)", () => {
  it("rejects zero or negative capacity", () => {
    expect(() => decideHit(null, { capacity: 0, refillWindowMs: 1 }, 0)).toThrow(RateLimitError);
    expect(() => decideHit(null, { capacity: -1, refillWindowMs: 1 }, 0)).toThrow(RateLimitError);
  });

  it("rejects non-finite refillWindowMs", () => {
    expect(() => decideHit(null, { capacity: 1, refillWindowMs: 0 }, 0)).toThrow(RateLimitError);
    expect(() => decideHit(null, { capacity: 1, refillWindowMs: Number.POSITIVE_INFINITY }, 0)).toThrow(RateLimitError);
  });

  it("rejects non-positive cost when explicitly set", () => {
    expect(() => decideHit(null, { capacity: 1, refillWindowMs: 1, cost: 0 }, 0)).toThrow(RateLimitError);
    expect(() => decideHit(null, { capacity: 1, refillWindowMs: 1, cost: -1 }, 0)).toThrow(RateLimitError);
  });
});
