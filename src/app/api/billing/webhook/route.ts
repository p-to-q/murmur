/**
 * POST /api/billing/webhook — Waffo Pancake webhook receiver.
 *
 *   1. Verify X-Waffo-Signature against the raw body.
 *   2. Record in events_webhook (provider + providerEventId unique).
 *   3. On order.completed: write purchases + grant notes (idempotent).
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { verifyWebhook, WebhookEventType } from "@waffo/pancake-ts";
import type { WebhookEvent, WebhookEventData } from "@waffo/pancake-ts";

import { isWaffoConfigured } from "@/lib/billing/waffo";
import {
  InvalidTopupPurchaseError,
  resolveWaffoTopupPurchase,
} from "@/lib/billing/topup-purchase";
import { db } from "@/lib/db/client";
import { eventsWebhook } from "@/lib/db/schema/events-webhook";
import { purchases } from "@/lib/db/schema/purchases";
import { grantNotes, reverseTopupGrant } from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/billing/webhook";
const ROUTE_ID = "billing.webhook.waffo";
const PROVIDER = "waffo";

class NonRetryableWebhookError extends Error {}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();

  if (!isWaffoConfigured()) {
    return NextResponse.json(
      { error: "waffo_not_configured", requestId },
      { status: 503 },
    );
  }

  const payload = await request.text();
  const signature = request.headers.get("x-waffo-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "missing_signature", requestId },
      { status: 400 },
    );
  }

  let event: WebhookEvent<WebhookEventData>;
  try {
    event = verifyWebhook(payload, signature);
  } catch (err) {
      log(
        "billing.webhook_failed",
        {
          stage: "signature",
          error: err instanceof Error ? err.message : String(err),
        },
        { route: ROUTE, requestId, level: "warn" },
      );
      return NextResponse.json(
        { error: "invalid_signature", requestId },
        { status: 401 },
      );
  }

  const insertedRows = await db
    .insert(eventsWebhook)
    .values({
      id: newId("evw"),
      provider: PROVIDER,
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

  const eventRow = insertedRows[0] ?? (await reclaimUnprocessedEvent(event.id));
  if (!eventRow) {
    return NextResponse.json({ received: true, duplicate: true, requestId });
  }

  log(
    "billing.webhook_received",
    {
      eventType: event.eventType,
      providerEventId: event.id,
      mode: event.mode,
    },
    { route: ROUTE, requestId },
  );

  try {
    const outcome = await handleWaffoEvent(event);
    await db
      .update(eventsWebhook)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(eventsWebhook.id, eventRow.id));
    return NextResponse.json({ received: true, ...outcome, requestId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = !(err instanceof NonRetryableWebhookError);

    log(
      "billing.webhook_failed",
      {
        stage: "process",
        eventType: event.eventType,
        providerEventId: event.id,
        error: message,
        retryable,
      },
      { route: ROUTE, requestId, level: "error" },
    );

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

async function reclaimUnprocessedEvent(
  providerEventId: string,
): Promise<{ id: string } | null> {
  const [existing] = await db
    .select({ id: eventsWebhook.id, status: eventsWebhook.status })
    .from(eventsWebhook)
    .where(
      and(
        eq(eventsWebhook.provider, PROVIDER),
        eq(eventsWebhook.providerEventId, providerEventId),
      ),
    )
    .limit(1);
  if (!existing || existing.status === "processed") return null;
  return { id: existing.id };
}

async function handleWaffoEvent(
  event: WebhookEvent<WebhookEventData>,
): Promise<Record<string, unknown>> {
  switch (event.eventType) {
    case WebhookEventType.OrderCompleted:
      return fulfillOrder(event.data);
    case WebhookEventType.RefundSucceeded:
      return refundOrder(event);
    default:
      return { ignored: event.eventType };
  }
}

async function fulfillOrder(
  data: WebhookEventData,
): Promise<Record<string, unknown>> {
  const orderId = data.orderId;
  if (!orderId) {
    throw new NonRetryableWebhookError("order.completed missing orderId");
  }

  let purchase;
  try {
    purchase = resolveWaffoTopupPurchase({
      orderId,
      orderMetadata: data.orderMetadata ?? undefined,
      amountDisplay: data.amount,
      currency: data.currency,
      paymentId: data.paymentId ?? null,
    });
  } catch (error) {
    if (error instanceof InvalidTopupPurchaseError) {
      throw new NonRetryableWebhookError(error.message);
    }
    throw error;
  }

  await db
    .insert(purchases)
    .values({
      id: newId("pur"),
      userId: purchase.userId,
      provider: PROVIDER,
      productId: purchase.productId,
      providerRef: orderId,
      amountCents: purchase.amountCents,
      currency: purchase.currency,
      notesGranted: purchase.notesGranted,
      status: "succeeded",
      rawPayload: data as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({
      target: [purchases.provider, purchases.providerRef],
    });

  const grant = await grantNotes({
    userId: purchase.userId,
    amount: purchase.notesGranted,
    reason: "purchase:topup",
    externalRef: orderId,
    metadata: {
      provider: PROVIDER,
      ...purchase.metadata,
      orderId,
      paymentId: purchase.paymentIntentId,
      waffoEventId: data.paymentId,
    },
  });

  if (!grant.ok) {
    throw new Error(
      `grantNotes failed for ${purchase.userId} on order ${orderId}: ${grant.reason}`,
    );
  }

  log(
    "notes.granted",
    {
      amount: purchase.notesGranted,
      skuId: purchase.productId,
      duplicate: grant.duplicate,
      orderId,
      balanceAfter: grant.balanceAfter,
    },
    { route: ROUTE, userId: purchase.userId },
  );

  return {
    granted: purchase.notesGranted,
    duplicate: grant.duplicate,
    orderId,
  };
}

async function refundOrder(
  event: WebhookEvent<WebhookEventData>,
): Promise<Record<string, unknown>> {
  const data = event.data;
  const orderId = data.orderId;
  if (!orderId) {
    throw new NonRetryableWebhookError("refund.succeeded missing orderId");
  }

  const [purchase] = await db
    .select({
      id: purchases.id,
      userId: purchases.userId,
      productId: purchases.productId,
      notesGranted: purchases.notesGranted,
      status: purchases.status,
    })
    .from(purchases)
    .where(and(eq(purchases.provider, PROVIDER), eq(purchases.providerRef, orderId)))
    .limit(1);

  if (!purchase) {
    throw new NonRetryableWebhookError(
      `refund.succeeded references unknown Waffo order ${orderId}`,
    );
  }

  if (purchase.status === "refunded") {
    return {
      refunded: 0,
      duplicate: true,
      orderId,
    };
  }

  const refundRef =
    typeof data.refundTicketMerchantExternalId === "string" && data.refundTicketMerchantExternalId.length > 0
      ? `waffo-refund:${data.refundTicketMerchantExternalId}`
      : event.eventId
        ? `waffo-refund:${event.eventId}`
        : `waffo-refund:${orderId}`;
  const reversal = await reverseTopupGrant({
    userId: purchase.userId,
    orderId,
    notesGranted: purchase.notesGranted,
    refundExternalRef: refundRef,
    metadata: {
      provider: PROVIDER,
      orderId,
      refundEventId: event.eventId,
      refundTicketMerchantExternalId: data.refundTicketMerchantExternalId,
      refundStatus: data.refundStatus,
      refundReason: data.refundReason,
      previousPurchaseStatus: purchase.status,
    },
  });

  if (!reversal.ok) {
    throw new Error(
      `reverseTopupGrant failed for ${purchase.userId} on order ${orderId}: ${reversal.reason}`,
    );
  }

  await db
    .update(purchases)
    .set({
      status: "refunded",
      rawPayload: data as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(and(eq(purchases.provider, PROVIDER), eq(purchases.providerRef, orderId)));

  log(
    "notes.granted",
    {
      amount: -reversal.amount,
      skuId: purchase.productId,
      duplicate: reversal.duplicate,
      orderId,
      balanceAfter: reversal.balanceAfter,
      reason: "refund:topup",
    },
    { route: ROUTE, userId: purchase.userId },
  );

  return {
    refunded: reversal.amount,
    duplicate: reversal.duplicate,
    orderId,
  };
}
