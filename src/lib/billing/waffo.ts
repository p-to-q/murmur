import { WaffoPancake } from "@waffo/pancake-ts";

import { resolveWaffoPrivateKey } from "@/lib/platform/waffo-server";

/**
 * Server-only Waffo Pancake client. Lazily constructed so builds and local dev
 * without credentials keep working — routes treat `null` as not configured.
 */

let cachedClient: WaffoPancake | null | undefined;

export function getWaffoClient(): WaffoPancake | null {
  if (cachedClient !== undefined) return cachedClient;

  const merchantId = process.env.WAFFO_MERCHANT_ID?.trim();
  const privateKey = resolveWaffoPrivateKey();
  cachedClient =
    merchantId && privateKey
      ? new WaffoPancake({ merchantId, privateKey })
      : null;
  return cachedClient;
}

/** One-time product used for all note top-ups (price set via priceSnapshot). */
export function getWaffoTopupProductId(): string | null {
  return process.env.WAFFO_TOPUP_PRODUCT_ID?.trim() || null;
}

export function isWaffoConfigured(): boolean {
  return getWaffoClient() !== null && getWaffoTopupProductId() !== null;
}

/** USD/CNY display amount → integer cents (JPY has no fractional cents). */
export function displayAmountToCents(amount: string, currency: string): number {
  const normalized = currency.toUpperCase();
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return 0;
  if (normalized === "JPY") return Math.round(value);
  return Math.round(value * 100);
}

export function centsToDisplayAmount(cents: number, currency: string): string {
  const normalized = currency.toUpperCase();
  if (normalized === "JPY") return String(Math.round(cents));
  return (cents / 100).toFixed(2);
}
