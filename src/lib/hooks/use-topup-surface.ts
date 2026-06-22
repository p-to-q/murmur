"use client";

import { useCallback, useEffect, useState } from "react";

import { request } from "@/lib/api/request";
import { useCurrentAccount } from "@/lib/hooks/use-current-account";

export interface TopupSurfaceData {
  lifetimeTopupCents: number;
  latestPlanSkuId: string | null;
}

export function useTopupSurface() {
  const { isRegistered, isLoading: accountLoading } = useCurrentAccount();
  const [data, setData] = useState<TopupSurfaceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<"unavailable" | null>(null);

  const refresh = useCallback(async () => {
    if (accountLoading) {
      setIsLoading(true);
      return null;
    }

    if (!isRegistered) {
      const nextData = {
        lifetimeTopupCents: 0,
        latestPlanSkuId: null,
      };
      setData(nextData);
      setError(null);
      setIsLoading(false);
      return nextData;
    }

    try {
      const response = await request("/api/user/topup-surface", { method: "GET" });
      if (!response.ok) {
        setData(null);
        setError("unavailable");
        return null;
      }
      const payload = (await response.json()) as Partial<TopupSurfaceData>;
      const nextData = {
        lifetimeTopupCents: typeof payload.lifetimeTopupCents === "number"
          ? payload.lifetimeTopupCents
          : 0,
        latestPlanSkuId: typeof payload.latestPlanSkuId === "string"
          ? payload.latestPlanSkuId
          : null,
      };
      setData(nextData);
      setError(null);
      return nextData;
    } catch {
      setData(null);
      setError("unavailable");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [accountLoading, isRegistered]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  return { data, isLoading, error, refresh };
}
