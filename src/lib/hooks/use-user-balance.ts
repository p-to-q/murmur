"use client";

import { useCallback, useEffect, useState } from "react";
import { request } from "@/lib/api/request";
import { useSession } from "next-auth/react";
import { getLocalBalance } from "@/lib/balance/balance-manager";

/**
 * Snapshot of the authenticated user's notes balance, as returned by
 * `GET /api/user/balance`.
 *
 * `nextRefillAt` is an ISO 8601 UTC string so the rendering layer can
 * format it for the user's locale. We deliberately keep this shape
 * forward-compatible with the v2 contract in `docs/page-contracts.md`
 * §11 (the future shared hook surface).
 */
export interface UserBalance {
  notes: number;
  planTier: "free" | "premium";
  nextRefillAt: string;
  /** Reserved for a future premium tier; current launch pricing returns false. */
  unlimited?: boolean;
}

export type UserBalanceFetchError = "unauthorized" | "unavailable";

export interface UserBalanceFetchResult {
  ok: boolean;
  balance: UserBalance | null;
  error: UserBalanceFetchError | null;
}

export interface UseUserBalanceResult {
  balance: UserBalance | null;
  isLoading: boolean;
  error: UserBalanceFetchError | null;
  refresh: () => Promise<UserBalanceFetchResult | null>;
}

const CACHE_TTL_MS = 30_000;
const ROUTE = "/api/user/balance";

// Module-scoped cache so every consumer shares the same snapshot. Tabs
// stay in sync without forcing a `BroadcastChannel`; the cache simply
// hands out the last good value until TTL or an explicit refresh.
let cachedBalance: UserBalance | null = null;
let cachedAt = 0;
let inflight: Promise<UserBalanceFetchResult> | null = null;
const subscribers = new Set<() => void>();

function publish(): void {
  for (const notify of subscribers) notify();
}

/**
 * Fetch the balance honoring the in-flight de-duplication. Returns a
 * structured result instead of throwing so the hook can render an error
 * banner instead of crashing the page.
 */
export async function fetchUserBalance(
  options: { force?: boolean } = {},
): Promise<UserBalanceFetchResult> {
  if (
    !options.force &&
    cachedBalance &&
    Date.now() - cachedAt < CACHE_TTL_MS
  ) {
    return { ok: true, balance: cachedBalance, error: null };
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await request(ROUTE, { method: "GET" });
      if (response.status === 401) {
        return { ok: false, balance: cachedBalance, error: "unauthorized" as const };
      }
      if (!response.ok) {
        return { ok: false, balance: cachedBalance, error: "unavailable" as const };
      }
      const payload = (await response.json()) as Partial<UserBalance> & {
        error?: string;
        unlimited?: boolean;
      };
      if (typeof payload.notes !== "number") {
        return { ok: false, balance: cachedBalance, error: "unavailable" as const };
      }
      const balance: UserBalance = {
        notes: payload.notes,
        planTier: payload.planTier === "premium" ? "premium" : "free",
        nextRefillAt: payload.nextRefillAt ?? new Date().toISOString(),
        unlimited: payload.unlimited === true,
      };
      cachedBalance = balance;
      cachedAt = Date.now();
      publish();
      return { ok: true, balance, error: null };
    } catch {
      return { ok: false, balance: cachedBalance, error: "unavailable" as const };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Test-only escape hatch for the module-scoped cache. */
export function __resetUserBalanceCacheForTesting(): void {
  cachedBalance = null;
  cachedAt = 0;
  inflight = null;
  subscribers.clear();
}

/**
 * Subscribe to the cached balance, refreshing on mount and whenever
 * another consumer publishes a fresh snapshot. The hook never blocks
 * rendering — `isLoading` is true only while the very first fetch is in
 * flight.
 *
 * For Local Creator: returns local balance from localStorage
 * For Google users: fetches from API
 */
export function useUserBalance(): UseUserBalanceResult {
  const { data: session, status } = useSession();
  const isSessionLoading = status === "loading";
  const isGoogleUser = !!session?.user;

  const [snapshot, setSnapshot] = useState<UserBalance | null>(cachedBalance);
  const [error, setError] = useState<UserBalanceFetchError | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(cachedBalance === null);

  const refresh = useCallback(async () => {
    if (isSessionLoading) {
      setIsLoading(cachedBalance === null);
      return cachedBalance
        ? { ok: true, balance: cachedBalance, error: null }
        : null;
    }

    if (!isGoogleUser) {
      const localBalance = getLocalBalance();
      const balance: UserBalance = {
        notes: localBalance.notes,
        planTier: "free",
        nextRefillAt: localBalance.nextRefillAt,
        unlimited: false,
      };
      setSnapshot(balance);
      setError(null);
      setIsLoading(false);
      return { ok: true, balance, error: null };
    }

    // Google user: fetch from API
    setIsLoading((prev) => prev || cachedBalance === null);
    const result = await fetchUserBalance({ force: true });
    setSnapshot((previous) => result.balance ?? previous);
    setError(result.error);
    setIsLoading(false);
    return result;
  }, [isGoogleUser, isSessionLoading]);

  useEffect(() => {
    let cancelled = false;

    if (isSessionLoading) {
      return;
    }

    if (!isGoogleUser) {
      // Local Creator: immediate local balance. localStorage can only be
      // read after mount (SSR has none), so this one post-mount render is
      // the hydration-safe pattern, not a cascading-update bug.
      const localBalance = getLocalBalance();
      queueMicrotask(() => {
        if (cancelled) return;
        setSnapshot({
          notes: localBalance.notes,
          planTier: "free",
          nextRefillAt: localBalance.nextRefillAt,
          unlimited: false,
        });
        setError(null);
        setIsLoading(false);
      });
      return;
    }

    // Google user: fetch from API
    const notify = () => {
      if (cancelled) return;
      setSnapshot(cachedBalance);
    };
    subscribers.add(notify);

    void (async () => {
      const result = await fetchUserBalance();
      if (cancelled) return;
      setSnapshot((previous) => result.balance ?? previous);
      setError(result.error);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
      subscribers.delete(notify);
    };
  }, [isGoogleUser, isSessionLoading]);

  return { balance: snapshot, isLoading, error, refresh };
}
