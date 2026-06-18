import type { Currency } from "@murmur/core";

export type MurmurCurrency = Currency;

/**
 * Detect the user's preferred payment currency from geo headers.
 *
 * Vercel provides `x-vercel-ip-country` (ISO 3166-1 alpha-2).
 * Cloudflare provides `cf-ipcountry`.
 * Falls back to USD when neither header is present.
 */
export function detectCurrencyFromHeaders(headers: Headers): MurmurCurrency {
  const country =
    headers.get("x-vercel-ip-country") ||
    headers.get("cf-ipcountry") ||
    "";
  return country.toUpperCase() === "CN" ? "CNY" : "USD";
}
