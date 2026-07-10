import Stripe from "stripe";

/**
 * Server-only Stripe client. Lazily constructed so builds and local dev
 * without STRIPE_SECRET_KEY keep working — routes must treat `null` as
 * "Stripe not configured" and answer 503 instead of crashing at import.
 */

let cachedClient: Stripe | null | undefined;

export function getStripeClient(): Stripe | null {
  if (cachedClient !== undefined) return cachedClient;

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  cachedClient = key ? new Stripe(key) : null;
  return cachedClient;
}

export function getStripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

/**
 * Optional pre-created Stripe Price id for a SKU, e.g.
 * STRIPE_PRICE_TOPUP_120_NOTES=price_123. When unset, checkout falls back
 * to inline price_data built from the canonical @murmur/core SKU table.
 */
export function getStripePriceId(skuId: string): string | null {
  return process.env[`STRIPE_PRICE_${skuId.toUpperCase()}`]?.trim() || null;
}
