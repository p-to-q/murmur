/**
 * POST /api/billing/checkout
 *
 * Creates a Waffo Pancake checkout session for a top-up SKU and returns
 * `{ checkoutUrl }` for the client to open in a new tab. The grant happens
 * in /api/billing/webhook when `order.completed` arrives.
 *
 * Body:
 *   - { sku: string } for canonical fixed tiers
 *   - { customAmountUsd: number } for the custom top-up flow
 *
 * Errors:
 *   400 invalid_topup_request
 *   401 (auth envelope)
 *   403 sign_in_required
 *   503 waffo_not_configured
 *   502 checkout_failed
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CUSTOM_TOPUP_ID,
  getCustomTopupQuote,
  getTopupSku,
  topupNotesGranted,
} from "@murmur/core";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import {
  centsToDisplayAmount,
  getWaffoClient,
  getWaffoTopupProductId,
  isWaffoConfigured,
} from "@/lib/billing/waffo";
import { log } from "@/lib/observability/log";
import { TaxCategory } from "@waffo/pancake-ts";

export const runtime = "nodejs";

const ROUTE = "/api/billing/checkout";
const CHECKOUT_RATE_LIMIT = { capacity: 10, refillWindowMs: 60_000 };

type CheckoutRequestBody = {
  sku?: unknown;
  customAmountUsd?: unknown;
};

type CheckoutProduct =
  | {
      kind: "sku";
      skuId: string;
      display: string;
      amountCents: number;
      currency: string;
      notesGranted: number;
      productName: string;
      productDescription: string;
      successQuery: string;
    }
  | {
      kind: "custom";
      skuId: typeof CUSTOM_TOPUP_ID;
      display: string;
      amountCents: number;
      currency: string;
      notesGranted: number;
      productName: string;
      productDescription: string;
      successQuery: string;
      customAmountUsd: number;
    };

function resolveAppOrigin(request: NextRequest): string {
  const configured = process.env.MURMUR_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return request.nextUrl.origin;
}

function parseCheckoutProduct(body: CheckoutRequestBody): CheckoutProduct | null {
  if (typeof body.customAmountUsd === "number") {
    const quote = getCustomTopupQuote(body.customAmountUsd);
    if (!quote) return null;
    return {
      kind: "custom",
      skuId: quote.id,
      display: quote.display,
      amountCents: quote.amountCents,
      currency: quote.defaultCurrency,
      notesGranted: quote.notesGranted,
      productName: `Murmur — ${quote.notesGranted} notes`,
      productDescription: `${quote.notesGranted} notes from a custom top up`,
      successQuery: `customAmountUsd=${encodeURIComponent(String(quote.amountUsd))}`,
      customAmountUsd: quote.amountUsd,
    };
  }

  const skuId = typeof body.sku === "string" ? body.sku : "";
  const sku = getTopupSku(skuId);
  if (!sku) return null;

  const notesGranted = topupNotesGranted(sku);
  return {
    kind: "sku",
    skuId: sku.id,
    display: sku.display,
    amountCents: sku.defaultPriceCents,
    currency: sku.defaultCurrency,
    notesGranted,
    productName: `Murmur — ${notesGranted} notes`,
    productDescription: `${sku.notes} notes${sku.bonusNotes ? ` + ${sku.bonusNotes} bonus` : ""}`,
    successQuery: `sku=${encodeURIComponent(sku.id)}`,
  };
}

function checkoutMetadata(
  userId: string,
  product: CheckoutProduct,
): Record<string, string> {
  const base: Record<string, string> = {
    userId,
    skuId: product.skuId,
    notesGranted: String(product.notesGranted),
    purchaseKind: product.kind === "custom" ? "custom" : "sku",
  };
  if (product.kind === "custom") {
    base.customAmountUsd = String(product.customAmountUsd);
    base.customAmountCents = String(product.amountCents);
  }
  return base;
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  let body: CheckoutRequestBody;
  try {
    body = (await request.json()) as CheckoutRequestBody;
  } catch {
    body = {};
  }

  const product = parseCheckoutProduct(body);
  if (!product) {
    return NextResponse.json(
      {
        error: "invalid_topup_request",
        message: "Provide a valid SKU or customAmountUsd between 1 and 999.",
        requestId,
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  if (!isWaffoConfigured()) {
    return NextResponse.json(
      {
        error: "waffo_not_configured",
        message: "Waffo payments are not configured on this deployment.",
        requestId,
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }

  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  if (userId === "guest" || auth.user.accountKind === "local_creator") {
    return NextResponse.json(
      {
        error: "sign_in_required",
        message: "Sign in before purchasing notes.",
        requestId,
      },
      { status: 403, headers: { "X-Request-Id": requestId } },
    );
  }

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "checkout",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: CHECKOUT_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  const client = getWaffoClient()!;
  const productId = getWaffoTopupProductId()!;
  const origin = resolveAppOrigin(request);
  const metadata = checkoutMetadata(userId, product);
  const displayAmount = centsToDisplayAmount(
    product.amountCents,
    product.currency,
  );

  try {
    const session = await client.checkout.createSession({
      productId,
      currency: product.currency,
      ...(auth.user.email ? { buyerEmail: auth.user.email } : {}),
      successUrl: `${origin}/topup/checkout?${product.successQuery}&status=success`,
      metadata,
      orderMerchantExternalId: `${userId}:${product.skuId}:${crypto.randomUUID()}`,
      priceSnapshot: {
        amount: displayAmount,
        taxCategory: TaxCategory.DigitalGoods,
      },
    });

    if (!session.checkoutUrl) {
      throw new Error("Waffo returned a session without checkoutUrl");
    }

    return NextResponse.json(
      {
        checkoutUrl: session.checkoutUrl,
        sessionId: session.sessionId,
        requestId,
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    log(
      "billing.checkout_failed",
      {
        error: err instanceof Error ? err.message : String(err),
        skuId: product.skuId,
      },
      {
        route: ROUTE,
        requestId,
        userId,
        sessionId: auth.sessionId,
        level: "error",
      },
    );
    return NextResponse.json(
      {
        error: "checkout_failed",
        message: "Could not start checkout. Please try again.",
        requestId,
      },
      { status: 502, headers: { "X-Request-Id": requestId } },
    );
  }
}
