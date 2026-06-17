"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { request } from "@/lib/api/request";

export interface TopupSurfaceData {
  lifetimeTopupCents: number;
  latestPlanSkuId: string | null;
}

export function useTopupSurface() {
  const { data: session, status } = useSession();
  const isGoogleUser = !!session?.user;
  const [data, setData] = useState<TopupSurfaceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<"unavailable" | null>(null);

  const refresh = useCallback(async () => {
    if (status === "loading") {
      setIsLoading(true);
      return null;
    }

    if (!isGoogleUser) {
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
  }, [isGoogleUser, status]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  return { data, isLoading, error, refresh };
}
