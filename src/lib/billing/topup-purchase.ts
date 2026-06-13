import {
  CUSTOM_TOPUP_ID,
  getCustomTopupQuote,
  getTopupSku,
  topupNotesGranted,
} from "@murmur/core";

import { displayAmountToCents } from "@/lib/billing/waffo";

export class InvalidTopupPurchaseError extends Error {}

export interface ResolvedTopupPurchase {
  userId: string;
  productId: string;
  notesGranted: number;
  amountCents: number;
  currency: string;
  paymentIntentId: string | null;
  metadata: Record<string, unknown>;
}

function resolveFromMetadata(
  providerRef: string,
  metadata: Record<string, string | undefined>,
  amountCents: number,
  currency: string,
  paymentId: string | null,
): ResolvedTopupPurchase {
  const userId = metadata.userId?.trim();
  if (!userId) {
    throw new InvalidTopupPurchaseError(
      `purchase ${providerRef} has no userId metadata`,
    );
  }

  const skuId = metadata.skuId ?? "";
  const metadataNotes = Number(metadata.notesGranted);
  const customAmountUsd = Number(metadata.customAmountUsd);

  let productId: string;
  let defaultAmountCents: number;
  let defaultCurrency: string;
  let notesGranted: number;
  let purchaseMetadata: Record<string, unknown>;

  if (skuId === CUSTOM_TOPUP_ID) {
    const quote = getCustomTopupQuote(customAmountUsd);
    if (!quote) {
      throw new InvalidTopupPurchaseError(
        `purchase ${providerRef} references invalid custom amount "${metadata.customAmountUsd ?? ""}"`,
      );
    }
    productId = quote.id;
    defaultAmountCents = quote.amountCents;
    defaultCurrency = quote.defaultCurrency;
    notesGranted =
      Number.isFinite(metadataNotes) && metadataNotes > 0
        ? Math.floor(metadataNotes)
        : quote.notesGranted;
    purchaseMetadata = { skuId: productId, customAmountUsd: quote.amountUsd };
    assertPaidAmountMatchesQuote(providerRef, amountCents, quote.amountCents);
    if (Number.isFinite(metadataNotes) && metadataNotes > 0 && metadataNotes !== quote.notesGranted) {
      throw new InvalidTopupPurchaseError(
        `purchase ${providerRef} notesGranted ${metadataNotes} does not match quote ${quote.notesGranted}`,
      );
    }
  } else {
    const sku = getTopupSku(skuId);
    if (!sku) {
      throw new InvalidTopupPurchaseError(
        `purchase ${providerRef} references unknown SKU "${skuId}"`,
      );
    }
    productId = sku.id;
    defaultAmountCents = sku.defaultPriceCents;
    defaultCurrency = sku.defaultCurrency;
    notesGranted =
      Number.isFinite(metadataNotes) && metadataNotes > 0
        ? Math.floor(metadataNotes)
        : topupNotesGranted(sku);
    purchaseMetadata = { skuId: productId };
    assertPaidAmountMatchesQuote(providerRef, amountCents, sku.defaultPriceCents);
    const expectedNotes = topupNotesGranted(sku);
    if (Number.isFinite(metadataNotes) && metadataNotes > 0 && metadataNotes !== expectedNotes) {
      throw new InvalidTopupPurchaseError(
        `purchase ${providerRef} notesGranted ${metadataNotes} does not match SKU ${expectedNotes}`,
      );
    }
  }

  return {
    userId,
    productId,
    notesGranted,
    amountCents: amountCents > 0 ? amountCents : defaultAmountCents,
    currency: currency || defaultCurrency,
    paymentIntentId: paymentId,
    metadata: purchaseMetadata,
  };
}

function assertPaidAmountMatchesQuote(
  providerRef: string,
  amountCents: number,
  expectedCents: number,
): void {
  if (amountCents <= 0 || expectedCents <= 0) return;
  if (amountCents !== expectedCents) {
    throw new InvalidTopupPurchaseError(
      `purchase ${providerRef} amount ${amountCents} does not match quote ${expectedCents}`,
    );
  }
}

/** @deprecated Use resolveWaffoTopupPurchase — Stripe removed from web checkout. */
export type ResolvedStripeTopupPurchase = ResolvedTopupPurchase;

export function resolveWaffoTopupPurchase(input: {
  orderId: string;
  orderMetadata?: Record<string, unknown> | null;
  amountDisplay: string;
  currency: string;
  paymentId?: string | null;
}): ResolvedTopupPurchase {
  const flat: Record<string, string | undefined> = {};
  if (input.orderMetadata) {
    for (const [key, value] of Object.entries(input.orderMetadata)) {
      if (value === null || value === undefined) continue;
      flat[key] = String(value);
    }
  }
  const amountCents = displayAmountToCents(
    input.amountDisplay,
    input.currency,
  );
  return resolveFromMetadata(
    input.orderId,
    flat,
    amountCents,
    input.currency.toUpperCase(),
    input.paymentId ?? null,
  );
}
