"use client";

import { useCallback, useEffect, useState } from "react";

import { request } from "@/lib/api/request";

export interface TopupSurfaceData {
  lifetimeTopupCents: number;
}

export function useTopupSurface() {
  const [data, setData] = useState<TopupSurfaceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<"unavailable" | null>(null);

  const refresh = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  return { data, isLoading, error, refresh };
}
