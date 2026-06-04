import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  __resetUserBalanceCacheForTesting,
  fetchUserBalance,
} from "@/lib/hooks/use-user-balance";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchUserBalance", () => {
  beforeEach(() => {
    __resetUserBalanceCacheForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetUserBalanceCacheForTesting();
  });

  it("returns the parsed balance for the happy path", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { notes: 12, planTier: "free", nextRefillAt: "2026-06-04T16:00:00.000Z" },
        200,
      )) as typeof fetch;

    const result = await fetchUserBalance({ force: true });
    expect(result.ok).toBe(true);
    expect(result.balance?.notes).toBe(12);
    expect(result.balance?.planTier).toBe("free");
    expect(result.error).toBeNull();
  });

  it("surfaces unauthorized on 401 without throwing", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "unauthorized" }, 401)) as typeof fetch;

    const result = await fetchUserBalance({ force: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unauthorized");
    expect(result.balance).toBeNull();
  });

  it("surfaces unavailable on 5xx without throwing", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "balance_unavailable" }, 503)) as typeof fetch;

    const result = await fetchUserBalance({ force: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unavailable");
  });

  it("normalizes an unknown planTier to free", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { notes: 4, planTier: "lifetime", nextRefillAt: "2026-06-04T16:00:00.000Z" },
        200,
      )) as typeof fetch;

    const result = await fetchUserBalance({ force: true });
    expect(result.balance?.planTier).toBe("free");
  });

  it("dedupes concurrent fetches via the in-flight promise", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse(
        { notes: 7, planTier: "free", nextRefillAt: "2026-06-04T16:00:00.000Z" },
        200,
      );
    }) as typeof fetch;

    const [a, b] = await Promise.all([
      fetchUserBalance({ force: true }),
      fetchUserBalance({ force: true }),
    ]);
    expect(calls).toBe(1);
    expect(a.balance?.notes).toBe(7);
    expect(b.balance?.notes).toBe(7);
  });
});
