"use client";

import { useCallback, useEffect, useState } from "react";

import { request } from "@/lib/api/request";
import type { AppUser } from "@/lib/platform/types";

export type CurrentAccountSource = "session" | "local_header" | "guest";

export interface CurrentAccount {
  user: AppUser | null;
  source: CurrentAccountSource | null;
  sessionId: string | null;
  authenticated: boolean;
  identityProviders: string[];
}

export type CurrentAccountFetchError = "unauthorized" | "unavailable";

export interface CurrentAccountFetchResult {
  ok: boolean;
  account: CurrentAccount | null;
  error: CurrentAccountFetchError | null;
}

export interface UseCurrentAccountResult {
  account: CurrentAccount | null;
  user: AppUser | null;
  isLoading: boolean;
  error: CurrentAccountFetchError | null;
  isRegistered: boolean;
  isLocalCreator: boolean;
  refresh: () => Promise<CurrentAccountFetchResult>;
}

const ROUTE = "/api/auth/me";
const CACHE_TTL_MS = 10_000;

let cachedAccount: CurrentAccount | null = null;
let cachedAt = 0;
let inflight: Promise<CurrentAccountFetchResult> | null = null;
const subscribers = new Set<() => void>();

function publish(): void {
  for (const subscriber of subscribers) subscriber();
}

export async function fetchCurrentAccount(
  options: { force?: boolean } = {},
): Promise<CurrentAccountFetchResult> {
  if (
    !options.force &&
    cachedAccount &&
    Date.now() - cachedAt < CACHE_TTL_MS
  ) {
    return { ok: true, account: cachedAccount, error: null };
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await request(ROUTE, {
        method: "GET",
        cache: "no-store",
      });
      if (response.status === 401) {
        cachedAccount = null;
        cachedAt = Date.now();
        publish();
        return { ok: false, account: null, error: "unauthorized" as const };
      }
      if (!response.ok) {
        return {
          ok: false,
          account: cachedAccount,
          error: "unavailable" as const,
        };
      }

      const payload = (await response.json()) as {
        user?: Partial<AppUser> | null;
        source?: CurrentAccountSource;
        authenticated?: boolean;
        sessionId?: string | null;
        identityProviders?: unknown;
      };
      if (!payload.user || typeof payload.user.id !== "string") {
        cachedAccount = null;
        cachedAt = Date.now();
        publish();
        return { ok: false, account: null, error: "unauthorized" as const };
      }

      const account: CurrentAccount = {
        user: {
          id: payload.user.id,
          email: payload.user.email ?? null,
          name: payload.user.name ?? null,
          avatarUrl: payload.user.avatarUrl ?? null,
          accountKind: payload.user.accountKind ?? null,
        },
        source: payload.source ?? null,
        sessionId: payload.sessionId ?? null,
        authenticated: payload.authenticated === true,
        identityProviders: Array.isArray(payload.identityProviders)
          ? payload.identityProviders.filter(
              (provider): provider is string => typeof provider === "string",
            )
          : [],
      };

      cachedAccount = account;
      cachedAt = Date.now();
      publish();
      return { ok: true, account, error: null };
    } catch {
      return {
        ok: false,
        account: cachedAccount,
        error: "unavailable" as const,
      };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function refreshCurrentAccount(): Promise<CurrentAccountFetchResult> {
  return fetchCurrentAccount({ force: true });
}

export function clearCurrentAccountCache(): void {
  cachedAccount = null;
  cachedAt = 0;
  inflight = null;
  publish();
}

export function __resetCurrentAccountCacheForTesting(): void {
  cachedAccount = null;
  cachedAt = 0;
  inflight = null;
  subscribers.clear();
}

export function useCurrentAccount(): UseCurrentAccountResult {
  const [account, setAccount] = useState<CurrentAccount | null>(cachedAccount);
  const [error, setError] = useState<CurrentAccountFetchError | null>(null);
  const [isLoading, setIsLoading] = useState(cachedAccount === null);

  const refresh = useCallback(async () => {
    setIsLoading((prev) => prev || cachedAccount === null);
    const result = await fetchCurrentAccount({ force: true });
    setAccount(result.account);
    setError(result.error);
    setIsLoading(false);
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const notify = () => {
      if (!cancelled) setAccount(cachedAccount);
    };
    subscribers.add(notify);

    void (async () => {
      const result = await fetchCurrentAccount();
      if (cancelled) return;
      setAccount(result.account);
      setError(result.error);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
      subscribers.delete(notify);
    };
  }, []);

  const user = account?.user ?? null;
  const isRegistered =
    Boolean(account?.authenticated) && user?.accountKind !== "local_creator";
  const isLocalCreator = user?.accountKind === "local_creator";

  return {
    account,
    user,
    isLoading,
    error,
    isRegistered,
    isLocalCreator,
    refresh,
  };
}
