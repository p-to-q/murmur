"use client";

import { useCallback, useEffect, useState } from "react";

import { request } from "@/lib/api/request";
import { useCurrentAccount } from "@/lib/hooks/use-current-account";

export interface TopupSurfaceData {
  lifetimeTopupCents: number;
  latestPlanSkuId: string | null;
  balanceHistory: TopupBalanceHistoryRange[];
  notesInUse: number;
}

export type TopupHistoryRange = "1H" | "1D" | "7D" | "1M" | "All";

export interface TopupBalanceHistoryPoint {
  timestamp: string;
  balance: number;
}

export interface TopupBalanceHistoryRange {
  range: TopupHistoryRange;
  points: TopupBalanceHistoryPoint[];
  changeValue: number;
  changePercent: number;
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
        balanceHistory: [],
        notesInUse: 0,
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
        balanceHistory: parseBalanceHistory(payload.balanceHistory),
        notesInUse: typeof payload.notesInUse === "number" && Number.isFinite(payload.notesInUse)
          ? Math.max(0, Math.round(payload.notesInUse))
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
  }, [accountLoading, isRegistered]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  return { data, isLoading, error, refresh };
}

function parseBalanceHistory(value: unknown): TopupBalanceHistoryRange[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((range): TopupBalanceHistoryRange[] => {
    if (!range || typeof range !== "object") return [];
    const record = range as Partial<TopupBalanceHistoryRange>;
    if (!isTopupHistoryRange(record.range) || !Array.isArray(record.points)) return [];

    return [{
      range: record.range,
      points: record.points.flatMap((point): TopupBalanceHistoryPoint[] => {
        if (!point || typeof point !== "object") return [];
        const pointRecord = point as Partial<TopupBalanceHistoryPoint>;
        if (typeof pointRecord.timestamp !== "string" || typeof pointRecord.balance !== "number") {
          return [];
        }
        return [{
          timestamp: pointRecord.timestamp,
          balance: Number.isFinite(pointRecord.balance) ? pointRecord.balance : 0,
        }];
      }),
      changeValue: typeof record.changeValue === "number" && Number.isFinite(record.changeValue)
        ? record.changeValue
        : 0,
      changePercent: typeof record.changePercent === "number" && Number.isFinite(record.changePercent)
        ? record.changePercent
        : 0,
    }];
  });
}

function isTopupHistoryRange(value: unknown): value is TopupHistoryRange {
  return value === "1H" || value === "1D" || value === "7D" || value === "1M" || value === "All";
}
