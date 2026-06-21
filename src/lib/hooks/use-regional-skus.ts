"use client";

/**
 * useRegionalSkus — fetches /api/billing/skus once and caches the result.
 *
 * Returns region-appropriate SKU pricing (CNY for mainland China, USD
 * elsewhere) plus custom topup config for the detected currency.
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

let cached: { currency: Currency; skus: RegionalSku[]; custom: CustomConfig } | null = null;

export function useRegionalSkus(): RegionalSkusResult {
  const [data, setData] = useState(cached);
  const [isLoading, setIsLoading] = useState(cached === null);

  useEffect(() => {
    const urlCurrency =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("currency")
        : null;
    if (cached && !urlCurrency) return;

    let cancelled = false;
    (async () => {
      try {
        const qs = urlCurrency ? `?currency=${encodeURIComponent(urlCurrency)}` : "";
        const res = await fetch(`/api/billing/skus${qs}`);
        if (!res.ok) return;
        const payload = (await res.json()) as {
          currency: Currency;
          skus: RegionalSku[];
          custom: CustomConfig;
        };
        cached = payload;
        if (!cancelled) {
          setData(payload);
        }
      } catch {
        // Silent — callers fall back to hardcoded TOPUP_SKUS
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    skus: data?.skus ?? [],
    currency: data?.currency ?? "USD",
    customConfig: data?.custom ?? {
      minAmount: 1,
      maxAmount: 999,
      notesPerUnit: 20,
      currency: "USD",
    },
    isLoading,
  };
}
