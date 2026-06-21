"use client";

/**
 * useRegionalSkus — fetches /api/billing/skus and caches per currency.
 *
 * Returns region-appropriate SKU pricing (CNY for mainland China, USD
 * elsewhere) plus custom topup config for the detected currency.
 *
 * Accepts an optional `forceCurrency` to let the TopupScreen currency
 * toggle drive re-fetches without a page reload.
 */

import { useEffect, useState } from "react";
import type { Currency } from "@murmur/core";

export interface RegionalSku {
  id: string;
  notes: number;
  bonusNotes: number;
  priceCents: number;
  currency: Currency;
  display: string;
  highlight: "popular" | "best_value" | null;
}

export interface CustomConfig {
  minAmount: number;
  maxAmount: number;
  notesPerUnit: number;
  currency: Currency;
}

export interface RegionalSkusResult {
  skus: RegionalSku[];
  currency: Currency;
  customConfig: CustomConfig;
  isLoading: boolean;
}

type CacheEntry = { currency: Currency; skus: RegionalSku[]; custom: CustomConfig };
const cacheMap: Record<string, CacheEntry> = {};

const STORAGE_KEY = "murmur-currency";

export function getSavedCurrency(): Currency | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "CNY" || v === "USD" ? v : null;
}

export function saveCurrencyPreference(currency: Currency) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, currency);
  }
}

export function useRegionalSkus(forceCurrency?: Currency): RegionalSkusResult {
  const urlCurrency =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("currency")?.toUpperCase()
      : null;
  const target: string | undefined =
    forceCurrency ?? (urlCurrency === "CNY" || urlCurrency === "USD" ? urlCurrency : undefined);
  const cacheKey = target ?? "_auto";
  const hit = cacheMap[cacheKey] ?? null;

  const [state, setState] = useState<{
    cacheKey: string;
    data: CacheEntry | null;
    isLoading: boolean;
  }>(() => ({
    cacheKey,
    data: hit,
    isLoading: hit === null,
  }));

  const currentData = hit ?? (state.cacheKey === cacheKey ? state.data : null);
  const currentIsLoading = currentData === null && (state.cacheKey !== cacheKey || state.isLoading);

  useEffect(() => {
    if (cacheMap[cacheKey]) return;

    let cancelled = false;
    (async () => {
      try {
        const qs = target ? `?currency=${encodeURIComponent(target)}` : "";
        const res = await fetch(`/api/billing/skus${qs}`);
        if (!res.ok) return;
        const payload = (await res.json()) as {
          currency: Currency;
          skus: RegionalSku[];
          custom: CustomConfig;
        };
        cacheMap[cacheKey] = payload;
        if (!cancelled) {
          setState({ cacheKey, data: payload, isLoading: false });
        }
      } catch {
        // Silent — callers fall back to hardcoded TOPUP_SKUS
      } finally {
        if (!cancelled && !cacheMap[cacheKey]) {
          setState({ cacheKey, data: null, isLoading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, target]);

  return {
    skus: currentData?.skus ?? [],
    currency: currentData?.currency ?? "USD",
    customConfig: currentData?.custom ?? {
      minAmount: 1,
      maxAmount: 999,
      notesPerUnit: 20,
      currency: "USD",
    },
    isLoading: currentIsLoading,
  };
}
