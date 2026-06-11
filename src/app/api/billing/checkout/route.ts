/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for a top-up SKU and returns
 * `{ checkoutUrl }` for the client to redirect to. The actual grant happens
 * in /api/billing/webhook when `checkout.session.completed` arrives — this
 * route never touches the notes ledger.
 *
 * Body:
 *   - { sku: string } for canonical fixed tiers
 *   - { customAmountUsd: number } for the custom top-up flow
 *
 * Errors:
 *   400 invalid_topup_request  — unknown SKU or invalid custom amount
 *   401 (auth envelope)        — no session
 *   403 sign_in_required      — guest users can't purchase (nothing durable
 *                                to grant to)
 *   503 stripe_not_configured  — STRIPE_SECRET_KEY unset (local dev)
 *   502 checkout_failed        — Stripe API error
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
import { getStripeClient, getStripePriceId } from "@/lib/billing/stripe";
import { log } from "@/lib/observability/log";

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

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  // Order matters: report "not configured" before "sign in required" so
  // keyless local dev gets the 503 and the client can run its stub flow
  // even as a guest. With keys present, guests still must sign in.
  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json(
      {
        error: "stripe_not_configured",
        message: "Stripe is not configured on this deployment.",
        requestId,
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }

  if (userId === "guest") {
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

  const origin = resolveAppOrigin(request);
  const priceId = product.kind === "sku" ? getStripePriceId(product.skuId) : null;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: userId,
      ...(auth.user.email ? { customer_email: auth.user.email } : {}),
      line_items: [
        priceId
          ? { price: priceId, quantity: 1 }
          : {
              price_data: {
                currency: product.currency.toLowerCase(),
                unit_amount: product.amountCents,
                product_data: {
                  name: product.productName,
                  description: product.productDescription,
                },
              },
              quantity: 1,
            },
      ],
      metadata: {
        userId,
        skuId: product.skuId,
        notesGranted: String(product.notesGranted),
        ...(product.kind === "custom"
          ? {
              customAmountUsd: String(product.customAmountUsd),
              customAmountCents: String(product.amountCents),
              purchaseKind: "custom",
            }
          : {
              purchaseKind: "sku",
            }),
      },
      payment_intent_data: {
        metadata: {
          userId,
          skuId: product.skuId,
          ...(product.kind === "custom"
            ? {
                customAmountUsd: String(product.customAmountUsd),
                customAmountCents: String(product.amountCents),
                purchaseKind: "custom",
              }
            : {
                purchaseKind: "sku",
              }),
        },
      },
      success_url: `${origin}/topup/checkout?${product.successQuery}&status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:
        product.kind === "custom"
          ? `${origin}/topup/checkout?customAmountUsd=${encodeURIComponent(String(product.customAmountUsd))}&status=canceled`
          : `${origin}/topup/checkout?sku=${encodeURIComponent(product.skuId)}&status=canceled`,
    });

    if (!session.url) {
      throw new Error("Stripe returned a session without a redirect URL");
    }

    return NextResponse.json(
      { checkoutUrl: session.url, sessionId: session.id, requestId },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    log("billing.checkout_failed", {
      error: err instanceof Error ? err.message : String(err),
      skuId: product.skuId,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
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
