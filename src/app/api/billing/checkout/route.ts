/**
 * POST /api/billing/checkout
 *
 * Creates a Waffo Pancake checkout session for a top-up SKU and returns
 * `{ checkoutUrl }` for the client to open in a new tab. The grant happens
 * in /api/billing/webhook when `order.completed` arrives.
 *
 * Body:
 *   - { sku: string, currency?: "USD"|"CNY" } for canonical fixed tiers
 *   - { customAmountUsd: number } for the USD custom top-up flow
 *   - { customAmountCny: number, currency: "CNY" } for the CNY custom top-up flow
 *   - optional { billingEmail: string } to prefill the hosted receipt email
 *
 * Errors:
 *   400 invalid_topup_request
 *   401 (auth envelope)
 *   403 sign_in_required
 *   503 waffo_not_configured
 *   502 checkout_failed
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  CUSTOM_TOPUP_ID,
  getCustomTopupQuote,
  getCustomTopupQuoteCny,
  getRegionalPrice,
  getTopupSku,
  topupNotesGranted,
  type Currency,
} from "@murmur/core";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import {
  centsToDisplayAmount,
  getWaffoClient,
  getWaffoTopupProductId,
  isWaffoConfigured,
} from "@/lib/billing/waffo";
import {
  isZpayConfigured,
  zpayCreateOrder,
  type ZpayPaymentType,
} from "@/lib/billing/zpay";
import { db } from "@/lib/db/client";
import { purchases } from "@/lib/db/schema/purchases";
import { log } from "@/lib/observability/log";
import { TaxCategory } from "@waffo/pancake-ts";

export const runtime = "nodejs";

const ROUTE = "/api/billing/checkout";
const CHECKOUT_RATE_LIMIT = { capacity: 10, refillWindowMs: 60_000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CheckoutRequestBody = {
  sku?: unknown;
  customAmountUsd?: unknown;
  customAmountCny?: unknown;
  currency?: unknown;
  payMethod?: unknown;
  billingEmail?: unknown;
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
      customAmountUsd?: number;
      customAmountCny?: number;
    };

function resolveAppOrigin(request: NextRequest): string {
  const configured = process.env.MURMUR_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return request.nextUrl.origin;
}

function parseCheckoutProduct(body: CheckoutRequestBody): CheckoutProduct | null {
  const requestedCurrency: Currency =
    typeof body.currency === "string" && body.currency.toUpperCase() === "CNY"
      ? "CNY"
      : "USD";

  // CNY custom topup
  if (typeof body.customAmountCny === "number" && requestedCurrency === "CNY") {
    const quote = getCustomTopupQuoteCny(body.customAmountCny);
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
      successQuery: `customAmountCny=${encodeURIComponent(String(quote.faceAmount))}&currency=CNY`,
      customAmountCny: quote.faceAmount,
    };
  }

  // USD custom topup
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
      successQuery: `customAmountUsd=${encodeURIComponent(String(quote.faceAmount))}`,
      customAmountUsd: quote.faceAmount,
    };
  }

  // Fixed SKU
  const skuId = typeof body.sku === "string" ? body.sku : "";
  const sku = getTopupSku(skuId);
  if (!sku) return null;

  const notesGranted = topupNotesGranted(sku);
  const regional = getRegionalPrice(sku, requestedCurrency);
  return {
    kind: "sku",
    skuId: sku.id,
    display: regional.display,
    amountCents: regional.priceCents,
    currency: regional.currency,
    notesGranted,
    productName: `Murmur — ${notesGranted} notes`,
    productDescription: `${sku.notes} notes${sku.bonusNotes ? ` + ${sku.bonusNotes} bonus` : ""}`,
    successQuery: `sku=${encodeURIComponent(sku.id)}&currency=${regional.currency}`,
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
    if (product.customAmountCny != null) {
      base.customAmountCny = String(product.customAmountCny);
    } else if (product.customAmountUsd != null) {
      base.customAmountUsd = String(product.customAmountUsd);
    }
    base.customAmountCents = String(product.amountCents);
  }
  return base;
}

function parseBillingEmail(
  body: CheckoutRequestBody,
  accountEmail: string | null | undefined,
): string | null | "invalid" {
  const candidate =
    typeof body.billingEmail === "string"
      ? body.billingEmail.trim().toLowerCase()
      : "";

  if (candidate) {
    return EMAIL_RE.test(candidate) ? candidate : "invalid";
  }

  const fallback = accountEmail?.trim().toLowerCase();
  if (!fallback) return null;
  return EMAIL_RE.test(fallback) ? fallback : null;
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
        message: "Provide a valid SKU, customAmountUsd (1-999), or customAmountCny (5-6999) with currency.",
        requestId,
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const billingEmail = parseBillingEmail(body, auth.user.email);
  if (billingEmail === "invalid") {
    return NextResponse.json(
      {
        error: "invalid_billing_email",
        message: "Provide a valid billing email address.",
        requestId,
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

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

  const payMethod = typeof body.payMethod === "string" ? body.payMethod : "";
  const useZpay =
    product.currency === "CNY" &&
    isZpayConfigured() &&
    payMethod === "wxpay";

  if (product.currency === "CNY" && payMethod === "wxpay" && !isZpayConfigured()) {
    return NextResponse.json(
      {
        error: "zpay_not_configured",
        message: "WeChat Pay is not configured on this deployment.",
        requestId,
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }

  if (!useZpay && !isWaffoConfigured()) {
    return NextResponse.json(
      {
        error: "waffo_not_configured",
        message: "Waffo payments are not configured on this deployment.",
        requestId,
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
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

  if (useZpay) {
    return handleZpayCheckout(
      request,
      userId,
      product,
      payMethod as ZpayPaymentType,
      billingEmail,
      requestId,
      auth.sessionId,
    );
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
      ...(billingEmail ? { buyerEmail: billingEmail } : {}),
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

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function handleZpayCheckout(
  request: NextRequest,
  userId: string,
  product: CheckoutProduct,
  payMethod: ZpayPaymentType,
  billingEmail: string | null,
  requestId: string,
  sessionId: string | null,
) {
  const origin = resolveAppOrigin(request);
  const outTradeNo = `${userId}:${product.skuId}:${randomUUID()}`;
  const moneyYuan = (product.amountCents / 100).toFixed(2);
  const notifyUrl = `${origin}/api/billing/zpay-notify`;
  const returnUrl = `${origin}/topup/checkout?${product.successQuery}&status=success`;
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  try {
    // Insert a pending purchase record so the webhook can resolve it
    await db.insert(purchases).values({
      id: newId("pur"),
      userId,
      provider: "zpay",
      productId: product.skuId,
      providerRef: outTradeNo,
      amountCents: product.amountCents,
      currency: "CNY",
      notesGranted: product.notesGranted,
      status: "pending",
      rawPayload: {
        payMethod,
        outTradeNo,
        moneyYuan,
        ...(billingEmail ? { billingEmail } : {}),
      },
    });

    const result = await zpayCreateOrder({
      outTradeNo,
      money: moneyYuan,
      name: `Murmur — ${product.notesGranted} 音磅`,
      type: payMethod,
      notifyUrl,
      returnUrl,
      clientIp,
    });

    return NextResponse.json(
      {
        checkoutUrl: result.payUrl,
        sessionId: outTradeNo,
        provider: "zpay",
        requestId,
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    log(
      "billing.zpay_checkout_failed",
      {
        error: err instanceof Error ? err.message : String(err),
        skuId: product.skuId,
        payMethod,
      },
      {
        route: ROUTE,
        requestId,
        userId,
        sessionId,
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
