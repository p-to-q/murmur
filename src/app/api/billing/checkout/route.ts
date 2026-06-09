/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for a top-up SKU and returns
 * `{ checkoutUrl }` for the client to redirect to. The actual grant happens
 * in /api/billing/webhook when `checkout.session.completed` arrives — this
 * route never touches the notes ledger.
 *
 * Body: { sku: string } — must be an id from @murmur/core TOPUP_SKUS.
 *
 * Errors:
 *   400 invalid_sku            — unknown SKU id
 *   401 (auth envelope)        — no session
 *   403 sign_in_required      — guest users can't purchase (nothing durable
 *                                to grant to)
 *   503 stripe_not_configured  — STRIPE_SECRET_KEY unset (local dev)
 *   502 checkout_failed        — Stripe API error
 */

import { NextRequest, NextResponse } from "next/server";
import { getTopupSku, topupNotesGranted } from "@murmur/core";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { getStripeClient, getStripePriceId } from "@/lib/billing/stripe";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/billing/checkout";
const CHECKOUT_RATE_LIMIT = { capacity: 10, refillWindowMs: 60_000 };

function resolveAppOrigin(request: NextRequest): string {
  const configured = process.env.MURMUR_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return request.nextUrl.origin;
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

  let skuId: string;
  try {
    const body = (await request.json()) as { sku?: unknown };
    skuId = typeof body.sku === "string" ? body.sku : "";
  } catch {
    skuId = "";
  }

  const sku = getTopupSku(skuId);
  if (!sku) {
    return NextResponse.json(
      { error: "invalid_sku", message: `Unknown SKU "${skuId}"`, requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const origin = resolveAppOrigin(request);
  const notesGranted = topupNotesGranted(sku);
  const priceId = getStripePriceId(sku.id);

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
                currency: sku.defaultCurrency.toLowerCase(),
                unit_amount: sku.defaultPriceCents,
                product_data: {
                  name: `Murmur — ${notesGranted} notes`,
                  description: `${sku.notes} notes${sku.bonusNotes ? ` + ${sku.bonusNotes} bonus` : ""}`,
                },
              },
              quantity: 1,
            },
      ],
      metadata: {
        userId,
        skuId: sku.id,
        notesGranted: String(notesGranted),
      },
      payment_intent_data: {
        metadata: { userId, skuId: sku.id },
      },
      success_url: `${origin}/topup/checkout?sku=${encodeURIComponent(sku.id)}&status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/topup/checkout?sku=${encodeURIComponent(sku.id)}&status=canceled`,
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
      skuId: sku.id,
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
