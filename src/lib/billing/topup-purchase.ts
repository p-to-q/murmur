import type Stripe from "stripe";
import {
  CUSTOM_TOPUP_ID,
  getCustomTopupQuote,
  getTopupSku,
  topupNotesGranted,
} from "@murmur/core";

export class InvalidTopupPurchaseError extends Error {}

export interface ResolvedStripeTopupPurchase {
  userId: string;
  productId: string;
  notesGranted: number;
  amountCents: number;
  currency: string;
  paymentIntentId: string | null;
  metadata: Record<string, unknown>;
}

export function resolveStripeTopupPurchase(
  session: Stripe.Checkout.Session,
): ResolvedStripeTopupPurchase {
  const userId = session.metadata?.userId || session.client_reference_id;
  if (!userId) {
    throw new InvalidTopupPurchaseError(
      `checkout session ${session.id} has no userId metadata`,
    );
  }

  const skuId = session.metadata?.skuId ?? "";
  const metadataNotes = Number(session.metadata?.notesGranted);
  const customAmountUsd = Number(session.metadata?.customAmountUsd);

  let productId: string;
  let defaultAmountCents: number;
  let defaultCurrency: string;
  let notesGranted: number;
  let metadata: Record<string, unknown>;

  if (skuId === CUSTOM_TOPUP_ID) {
    const quote = getCustomTopupQuote(customAmountUsd);
    if (!quote) {
      throw new InvalidTopupPurchaseError(
        `checkout session ${session.id} references invalid custom amount "${session.metadata?.customAmountUsd ?? ""}"`,
      );
    }
    productId = quote.id;
    defaultAmountCents = quote.amountCents;
    defaultCurrency = quote.defaultCurrency;
    notesGranted =
      Number.isFinite(metadataNotes) && metadataNotes > 0
        ? Math.floor(metadataNotes)
        : quote.notesGranted;
    metadata = { skuId: productId, customAmountUsd: quote.amountUsd };
  } else {
    const sku = getTopupSku(skuId);
    if (!sku) {
      throw new InvalidTopupPurchaseError(
        `checkout session ${session.id} references unknown SKU "${skuId}"`,
      );
    }
    productId = sku.id;
    defaultAmountCents = sku.defaultPriceCents;
    defaultCurrency = sku.defaultCurrency;
    notesGranted =
      Number.isFinite(metadataNotes) && metadataNotes > 0
        ? Math.floor(metadataNotes)
        : topupNotesGranted(sku);
    metadata = { skuId: productId };
  }

  return {
    userId,
    productId,
    notesGranted,
    amountCents: session.amount_total ?? defaultAmountCents,
    currency: (session.currency ?? defaultCurrency).toUpperCase(),
    paymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
    metadata,
  };
}
