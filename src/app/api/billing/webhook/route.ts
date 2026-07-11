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

import { getRequestId } from "@/lib/api/request-id";
import { displayAmountToCents, isWaffoConfigured } from "@/lib/billing/waffo";
import {
  InvalidTopupPurchaseError,
  isWaffoPendingProviderRef,
  resolveWaffoTopupPurchase,
} from "@/lib/billing/topup-purchase";
import { db } from "@/lib/db/client";
import { eventsWebhook } from "@/lib/db/schema/events-webhook";
import { purchases } from "@/lib/db/schema/purchases";
import {
  grantNotesInTransaction,
  reverseTopupGrant,
} from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/billing/webhook";
const ROUTE_ID = "billing.webhook.waffo";
const PROVIDER = "waffo";

class NonRetryableWebhookError extends Error {}

/**
 * A refund.succeeded that arrives before its order.completed has been recorded
 * (#314). The purchase row does not exist *yet*, but it is expected to — provider
 * event delivery can reorder — so this is a TRANSIENT condition, not a permanent
 * one. Throwing a retryable error (not `NonRetryableWebhookError`) makes the route
 * answer non-2xx so Waffo redelivers, instead of acking 200 and permanently
 * dropping a real refund. Once order.completed lands, the redelivered refund
 * finds the purchase and reverses exactly once (reverseTopupGrant is idempotent).
 */
class OutOfOrderRefundError extends Error {}

type RefundAmountDecision =
  | {
      ok: true;
      refundAmountCents: number;
    }
  | {
      ok: false;
      reason:
        | "refund_amount_missing"
        | "refund_amount_invalid"
        | "refund_currency_missing"
        | "refund_currency_mismatch"
        | "refund_amount_exceeds_purchase"
        | "partial_refund_not_supported";
      refundAmountCents?: number;
      refundCurrency?: string;
    };

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  if (!isWaffoConfigured()) {
    return NextResponse.json(
      { error: "waffo_not_configured", requestId },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }

  const payload = await request.text();
  const signature = request.headers.get("x-waffo-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "missing_signature", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
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
        { status: 401, headers: { "X-Request-Id": requestId } },
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
    return NextResponse.json({ received: true, duplicate: true, requestId }, { headers: { "X-Request-Id": requestId } });
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
    return NextResponse.json({ received: true, ...outcome, requestId }, { headers: { "X-Request-Id": requestId } });
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
        { status: 500, headers: { "X-Request-Id": requestId } },
      );
    }
    return NextResponse.json(
      { received: true, error: "non_retryable", requestId },
      { headers: { "X-Request-Id": requestId } },
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

  const metadataPendingRef =
    typeof data.orderMetadata?.pendingProviderRef === "string"
      ? data.orderMetadata.pendingProviderRef
      : null;
  const externalPendingRef =
    typeof data.orderMerchantExternalId === "string"
      ? data.orderMerchantExternalId
      : null;
  const isAuthoritativeCheckout =
    isWaffoPendingProviderRef(metadataPendingRef) ||
    isWaffoPendingProviderRef(externalPendingRef);

  if (
    isAuthoritativeCheckout &&
    (!metadataPendingRef ||
      !externalPendingRef ||
      metadataPendingRef !== externalPendingRef)
  ) {
    throw new NonRetryableWebhookError(
      `order ${orderId} has mismatched pending purchase references`,
    );
  }

  // Finalize the authoritative pending purchase and grant its notes in one
  // transaction. Legacy sessions created before pending snapshots existed are
  // still inserted from their validated metadata so in-flight checkouts keep
  // working during deployment.
  const grant = await db.transaction(async (tx) => {
    let authoritativePurchase = await findPurchaseForUpdate(tx, orderId);

    if (!authoritativePurchase && isAuthoritativeCheckout) {
      authoritativePurchase = await findPurchaseForUpdate(
        tx,
        externalPendingRef!,
      );
      // A concurrent delivery can switch the reference while this transaction
      // waits for the pending row lock. Re-check the final order id before
      // classifying the purchase as unknown.
      if (!authoritativePurchase) {
        authoritativePurchase = await findPurchaseForUpdate(tx, orderId);
      }
      if (!authoritativePurchase) {
        throw new NonRetryableWebhookError(
          `order ${orderId} references unknown pending purchase ${externalPendingRef}`,
        );
      }
    }

    if (authoritativePurchase) {
      assertPurchaseSnapshotMatches(authoritativePurchase, purchase, data);
      if (authoritativePurchase.status === "pending") {
        await tx
          .update(purchases)
          .set({
            providerRef: orderId,
            status: "succeeded",
            rawPayload: data as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          })
          .where(eq(purchases.id, authoritativePurchase.id));
        authoritativePurchase = {
          ...authoritativePurchase,
          providerRef: orderId,
          status: "succeeded",
        };
      } else if (
        authoritativePurchase.status !== "succeeded" &&
        authoritativePurchase.status !== "refunded"
      ) {
        throw new NonRetryableWebhookError(
          `order ${orderId} references purchase in ${authoritativePurchase.status} status`,
        );
      }
    } else {
      await tx
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
    }

    const grantPurchase = authoritativePurchase ?? purchase;

    const result = await grantNotesInTransaction(tx, {
      userId: grantPurchase.userId,
      amount: grantPurchase.notesGranted,
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

    // Throw inside the transaction so a failed grant rolls the purchase insert
    // back with it — the whole point of #240. The POST handler's catch marks
    // the event failed and returns a retryable 500.
    if (!result.ok) {
      throw new Error(
        `grantNotes failed for ${grantPurchase.userId} on order ${orderId}: ${result.reason}`,
      );
    }

    return result;
  });

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

type PurchaseSnapshot = {
  id: string;
  userId: string;
  productId: string;
  providerRef: string;
  amountCents: number;
  currency: string;
  notesGranted: number;
  status: string;
};

type PurchaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function findPurchaseForUpdate(
  tx: PurchaseTransaction,
  providerRef: string,
): Promise<PurchaseSnapshot | null> {
  const [purchase] = await tx
    .select({
      id: purchases.id,
      userId: purchases.userId,
      productId: purchases.productId,
      providerRef: purchases.providerRef,
      amountCents: purchases.amountCents,
      currency: purchases.currency,
      notesGranted: purchases.notesGranted,
      status: purchases.status,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.provider, PROVIDER),
        eq(purchases.providerRef, providerRef),
      ),
    )
    .limit(1)
    .for("update");
  return purchase ?? null;
}

function assertPurchaseSnapshotMatches(
  expected: PurchaseSnapshot,
  resolved: ReturnType<typeof resolveWaffoTopupPurchase>,
  data: WebhookEventData,
): void {
  const metadataUserId = data.orderMetadata?.userId?.trim();
  const metadataSkuId = data.orderMetadata?.skuId;
  const metadataNotes = Number(data.orderMetadata?.notesGranted);
  const paidCurrency = data.currency.trim().toUpperCase();
  const paidAmountCents = displayAmountToCents(data.amount, paidCurrency);
  const expectedCurrency = expected.currency.trim().toUpperCase();

  const mismatch =
    expected.userId !== resolved.userId ||
    expected.productId !== resolved.productId ||
    expected.amountCents !== paidAmountCents ||
    expectedCurrency !== paidCurrency ||
    expected.notesGranted !== resolved.notesGranted ||
    metadataUserId !== expected.userId ||
    metadataSkuId !== expected.productId ||
    !Number.isInteger(metadataNotes) ||
    metadataNotes !== expected.notesGranted;

  if (mismatch) {
    throw new NonRetryableWebhookError(
      `order ${data.orderId} does not match pending purchase snapshot ${expected.id}`,
    );
  }
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
      amountCents: purchases.amountCents,
      currency: purchases.currency,
      notesGranted: purchases.notesGranted,
      status: purchases.status,
    })
    .from(purchases)
    .where(and(eq(purchases.provider, PROVIDER), eq(purchases.providerRef, orderId)))
    .limit(1);

  if (!purchase) {
    // #314: keep an out-of-order refund retryable rather than acking 200. Record
    // the reorder distinctly so the redelivery (after order.completed) is
    // auditable, then throw a retryable error → the POST handler returns 500 and
    // Waffo redelivers. Duplicate/partial refund idempotency is unaffected: this
    // branch only fires when NO purchase row exists yet.
    log(
      "billing.webhook_refund_out_of_order",
      {
        orderId,
        providerEventId: event.id,
        refundEventId: event.eventId,
      },
      { route: ROUTE, level: "warn" },
    );
    throw new OutOfOrderRefundError(
      `refund.succeeded references not-yet-recorded Waffo order ${orderId}`,
    );
  }

  if (purchase.status === "refunded") {
    return {
      refunded: 0,
      duplicate: true,
      orderId,
    };
  }

  const amountDecision = decideRefundAmount(data, {
    amountCents: purchase.amountCents,
    currency: purchase.currency,
  });
  if (!amountDecision.ok) {
    log(
      "billing.webhook_failed",
      {
        stage: "manual_review",
        risk: amountDecision.reason,
        orderId,
        refundAmountCents: amountDecision.refundAmountCents,
        refundCurrency: amountDecision.refundCurrency,
        purchaseAmountCents: purchase.amountCents,
        purchaseCurrency: purchase.currency,
        providerEventId: event.id,
        refundEventId: event.eventId,
      },
      { route: ROUTE, userId: purchase.userId, level: "warn" },
    );

    return {
      manualReview: true,
      risk: amountDecision.reason,
      orderId,
      refundAmountCents: amountDecision.refundAmountCents,
      purchaseAmountCents: purchase.amountCents,
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
      refundAmountCents: amountDecision.refundAmountCents,
      purchaseAmountCents: purchase.amountCents,
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

function decideRefundAmount(
  data: WebhookEventData,
  purchase: { amountCents: number; currency: string },
): RefundAmountDecision {
  const refundCurrency =
    typeof data.currency === "string" ? data.currency.trim().toUpperCase() : "";
  const purchaseCurrency = purchase.currency.trim().toUpperCase();
  if (!refundCurrency) {
    return { ok: false, reason: "refund_currency_missing" };
  }
  if (refundCurrency !== purchaseCurrency) {
    return {
      ok: false,
      reason: "refund_currency_mismatch",
      refundCurrency,
    };
  }

  if (typeof data.amount !== "string" || data.amount.trim().length === 0) {
    return { ok: false, reason: "refund_amount_missing", refundCurrency };
  }

  const refundAmountCents = displayAmountToCents(data.amount, refundCurrency);
  if (!Number.isInteger(refundAmountCents) || refundAmountCents <= 0) {
    return {
      ok: false,
      reason: "refund_amount_invalid",
      refundAmountCents,
      refundCurrency,
    };
  }

  if (refundAmountCents > purchase.amountCents) {
    return {
      ok: false,
      reason: "refund_amount_exceeds_purchase",
      refundAmountCents,
      refundCurrency,
    };
  }

  if (refundAmountCents !== purchase.amountCents) {
    return {
      ok: false,
      reason: "partial_refund_not_supported",
      refundAmountCents,
      refundCurrency,
    };
  }

  return { ok: true, refundAmountCents };
}
