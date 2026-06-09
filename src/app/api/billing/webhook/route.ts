/**
 * POST /api/billing/webhook — Stripe webhook receiver.
 *
 * Flow per docs/data-model.md §3.7 + docs/api-conventions.md §10:
 *   1. Verify the Stripe signature against the raw body.
 *   2. Record the event in events_webhook; the (provider, providerEventId)
 *      unique index makes redelivery a no-op.
 *   3. On checkout.session.completed (paid): write the purchases row and
 *      grant notes via the ledger. Both writes are idempotent — purchases
 *      via (provider, providerRef), the grant via (userId, reason,
 *      externalRef) — so Stripe retries can never double-grant.
 *
 * Responses: 2xx tells Stripe to stop retrying. We return 500 only for
 * failures that a retry can fix (DB blips, user row not yet provisioned);
 * permanently malformed payloads are marked failed and answered 200.
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getTopupSku, topupNotesGranted } from "@murmur/core";

import { getStripeClient, getStripeWebhookSecret } from "@/lib/billing/stripe";
import { db } from "@/lib/db/client";
import { eventsWebhook } from "@/lib/db/schema/events-webhook";
import { purchases } from "@/lib/db/schema/purchases";
import { grantNotes } from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/billing/webhook";
const ROUTE_ID = "billing.webhook.stripe";

/** Payload is malformed in a way no retry can fix — record + acknowledge. */
class NonRetryableWebhookError extends Error {}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();

  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "stripe_not_configured", requestId },
      { status: 503 },
    );
  }

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "missing_signature", requestId },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
    );
  } catch (err) {
    log("billing.webhook_failed", {
      stage: "signature",
      error: err instanceof Error ? err.message : String(err),
    }, { route: ROUTE, requestId, level: "warn" });
    return NextResponse.json(
      { error: "invalid_signature", requestId },
      { status: 400 },
    );
  }

  // Idempotency gate: first delivery inserts, redeliveries hit the unique
  // index and bail out here.
  const insertedRows = await db
    .insert(eventsWebhook)
    .values({
      id: newId("evw"),
      provider: "stripe",
      providerEventId: event.id,
      routeId: ROUTE_ID,
      status: "received",
      signatureOk: true,
      rawPayload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({
      target: [eventsWebhook.provider, eventsWebhook.providerEventId],
    })
    .returning({ id: eventsWebhook.id });

  const eventRow = insertedRows[0];
  if (!eventRow) {
    return NextResponse.json({ received: true, duplicate: true, requestId });
  }

  log("billing.webhook_received", {
    eventType: event.type,
    providerEventId: event.id,
  }, { route: ROUTE, requestId });

  try {
    const outcome = await handleStripeEvent(event);
    await db
      .update(eventsWebhook)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(eventsWebhook.id, eventRow.id));
    return NextResponse.json({ received: true, ...outcome, requestId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = !(err instanceof NonRetryableWebhookError);

    log("billing.webhook_failed", {
      stage: "process",
      eventType: event.type,
      providerEventId: event.id,
      error: message,
      retryable,
    }, { route: ROUTE, requestId, level: "error" });

    await db
      .update(eventsWebhook)
      .set({ status: "failed", processedAt: new Date(), error: message })
      .where(eq(eventsWebhook.id, eventRow.id))
      .catch(() => {});

    if (retryable) {
      return NextResponse.json(
        { error: "webhook_processing_failed", requestId },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { received: true, error: "non_retryable", requestId },
    );
  }
}

async function handleStripeEvent(
  event: Stripe.Event,
): Promise<Record<string, unknown>> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return fulfillCheckoutSession(
        event.data.object as Stripe.Checkout.Session,
      );
    default:
      return { ignored: event.type };
  }
}

async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<Record<string, unknown>> {
  if (session.payment_status !== "paid") {
    // Delayed payment methods complete later via async_payment_succeeded.
    return { ignored: "unpaid", sessionId: session.id };
  }

  const userId = session.metadata?.userId || session.client_reference_id;
  if (!userId) {
    throw new NonRetryableWebhookError(
      `checkout session ${session.id} has no userId metadata`,
    );
  }

  const skuId = session.metadata?.skuId ?? "";
  const sku = getTopupSku(skuId);
  if (!sku) {
    throw new NonRetryableWebhookError(
      `checkout session ${session.id} references unknown SKU "${skuId}"`,
    );
  }

  const metadataNotes = Number(session.metadata?.notesGranted);
  const notesGranted =
    Number.isFinite(metadataNotes) && metadataNotes > 0
      ? Math.floor(metadataNotes)
      : topupNotesGranted(sku);

  // Purchases row first (FK on users also guards against granting to a user
  // that doesn't exist yet — retry once the profile upsert lands).
  await db
    .insert(purchases)
    .values({
      id: newId("pur"),
      userId,
      provider: "stripe",
      productId: sku.id,
      providerRef: session.id,
      amountCents: session.amount_total ?? sku.defaultPriceCents,
      currency: (session.currency ?? sku.defaultCurrency).toUpperCase(),
      notesGranted,
      status: "succeeded",
      rawPayload: session as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({
      target: [purchases.provider, purchases.providerRef],
    });

  const grant = await grantNotes({
    userId,
    amount: notesGranted,
    reason: "purchase:topup",
    externalRef: session.id,
    metadata: {
      provider: "stripe",
      skuId: sku.id,
      checkoutSessionId: session.id,
      paymentIntent:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
    },
  });

  if (!grant.ok) {
    // user_not_found — the profile upsert may simply not have landed yet.
    throw new Error(
      `grantNotes failed for ${userId} on session ${session.id}: ${grant.reason}`,
    );
  }

  log("notes.granted", {
    amount: notesGranted,
    skuId: sku.id,
    duplicate: grant.duplicate,
    sessionId: session.id,
    balanceAfter: grant.balanceAfter,
  }, { route: ROUTE, userId });

  return {
    granted: notesGranted,
    duplicate: grant.duplicate,
    sessionId: session.id,
  };
}
