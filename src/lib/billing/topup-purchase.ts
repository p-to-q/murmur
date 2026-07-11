import {
  CUSTOM_TOPUP_ID,
  getCustomTopupQuote,
  getCustomTopupQuoteCny,
  getTopupSku,
  getRegionalPrice,
  topupNotesGranted,
} from "@murmur/core";

import { displayAmountToCents } from "@/lib/billing/waffo";

export class InvalidTopupPurchaseError extends Error {}

export const WAFFO_PENDING_PROVIDER_REF_PREFIX = "waffo-pending:";

export function waffoPendingProviderRef(purchaseId: string): string {
  return `${WAFFO_PENDING_PROVIDER_REF_PREFIX}${purchaseId}`;
}

export function isWaffoPendingProviderRef(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(WAFFO_PENDING_PROVIDER_REF_PREFIX));
}

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
    // Try CNY quote first if metadata signals a CNY custom purchase
    const customAmountCny = Number(metadata.customAmountCny);
    const cnyQuote =
      Number.isFinite(customAmountCny) && customAmountCny > 0
        ? getCustomTopupQuoteCny(customAmountCny)
        : null;
    const quote = cnyQuote ?? getCustomTopupQuote(customAmountUsd);
    if (!quote) {
      throw new InvalidTopupPurchaseError(
        `purchase ${providerRef} references invalid custom amount "${metadata.customAmountUsd ?? metadata.customAmountCny ?? ""}"`,
      );
    }
    productId = quote.id;
    defaultAmountCents = quote.amountCents;
    defaultCurrency = quote.defaultCurrency;
    notesGranted =
      Number.isFinite(metadataNotes) && metadataNotes > 0
        ? Math.floor(metadataNotes)
        : quote.notesGranted;
    purchaseMetadata = cnyQuote
      ? { skuId: productId, customAmountCny: cnyQuote.faceAmount }
      : { skuId: productId, customAmountUsd: quote.faceAmount };
    assertPaidAmountMatchesQuote(
      providerRef,
      amountCents,
      quote.amountCents,
      currency,
      quote.defaultCurrency,
    );
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
    // When the payment was in CNY, validate against the CNY price
    const regional =
      currency.toUpperCase() === "CNY"
        ? getRegionalPrice(sku, "CNY")
        : getRegionalPrice(sku, "USD");
    productId = sku.id;
    defaultAmountCents = regional.priceCents;
    defaultCurrency = regional.currency;
    notesGranted =
      Number.isFinite(metadataNotes) && metadataNotes > 0
        ? Math.floor(metadataNotes)
        : topupNotesGranted(sku);
    purchaseMetadata = { skuId: productId };
    assertPaidAmountMatchesQuote(
      providerRef,
      amountCents,
      regional.priceCents,
      currency,
      regional.currency,
    );
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
  paidCurrency: string,
  quoteCurrency: string,
): void {
  if (amountCents <= 0 || expectedCents <= 0) return;
  // Cents are only comparable in the quote's own currency. Checkout pins the
  // session currency, so a mismatch here means the provider settled in a
  // converted currency — equality against USD cents would reject a legit
  // payment, so we rely on the metadata/notes validation instead.
  if (paidCurrency.toUpperCase() !== quoteCurrency.toUpperCase()) return;
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
