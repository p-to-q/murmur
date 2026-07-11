/**
 * POST /api/billing/zpay-notify — zpay async payment callback.
 *
 * zpay sends form-urlencoded params when payment completes.
 * We verify the signature, grant notes, and respond with plain "success".
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { isZpayConfigured, zpayVerifyNotify } from "@/lib/billing/zpay";
import { db } from "@/lib/db/client";
import { eventsWebhook } from "@/lib/db/schema/events-webhook";
import { purchases } from "@/lib/db/schema/purchases";
import { grantNotes } from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/billing/zpay-notify";
const PROVIDER = "zpay";

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function parseUniqueFormParams(body: string): Record<string, string> | null {
  const params: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(body)) {
    if (Object.prototype.hasOwnProperty.call(params, key)) return null;
    params[key] = value;
  }
  return params;
}

function parseCnyCents(money: string): number | null {
  const normalized = money.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

async function markEventFailed(eventRowId: string, error: string) {
  await db
    .update(eventsWebhook)
    .set({ status: "failed", processedAt: new Date(), error })
    .where(eq(eventsWebhook.id, eventRowId));
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  if (!isZpayConfigured()) {
    return new NextResponse("zpay not configured", { status: 503 });
  }

  const body = await request.text();
  const params = parseUniqueFormParams(body);
  if (!params) {
    log("billing.zpay_notify_failed", { stage: "params" }, { route: ROUTE, requestId, level: "warn" });
    return new NextResponse("fail", { status: 400 });
  }

  const verified = zpayVerifyNotify(params);
  if (!verified) {
    log("billing.zpay_notify_failed", { stage: "signature" }, { route: ROUTE, requestId, level: "warn" });
    return new NextResponse("fail", { status: 401 });
  }

  if (verified.trade_status !== "TRADE_SUCCESS") {
    return new NextResponse("success");
  }

  const outTradeNo = verified.out_trade_no;

  const providerEventId = `zpay:${verified.trade_no}`;
  const insertedRows = await db
    .insert(eventsWebhook)
    .values({
      id: newId("evw"),
      provider: PROVIDER,
      providerEventId,
      routeId: "billing.webhook.zpay",
      status: "received",
      signatureOk: true,
      rawPayload: verified as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({
      target: [eventsWebhook.provider, eventsWebhook.providerEventId],
    })
    .returning({ id: eventsWebhook.id });

  const eventRow = insertedRows[0] ?? (await reclaimUnprocessedEvent(providerEventId));
  if (!eventRow) {
    return new NextResponse("success");
  }

  const eventRowId = eventRow.id;

  // Parse our out_trade_no format: {userId}:{skuId}:{uuid}
  const parts = outTradeNo.split(":");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    log("billing.zpay_notify_failed", { stage: "parse", outTradeNo }, { route: ROUTE, requestId, level: "error" });
    await markEventFailed(eventRowId, "invalid out_trade_no format");
    return new NextResponse("success");
  }

  const outUserId = parts[0]!;
  const outSkuId = parts[1]!;

  // Resolve notes from the pending_zpay_orders metadata stored at checkout time
  // We look up the purchase record created during checkout
  const [pendingPurchase] = await db
    .select({
      id: purchases.id,
      userId: purchases.userId,
      productId: purchases.productId,
      notesGranted: purchases.notesGranted,
      amountCents: purchases.amountCents,
      currency: purchases.currency,
      status: purchases.status,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.provider, PROVIDER),
        eq(purchases.providerRef, outTradeNo),
      ),
    )
    .limit(1);

  if (!pendingPurchase) {
    log("billing.zpay_notify_failed", { stage: "no_pending", outTradeNo }, { route: ROUTE, requestId, level: "error" });
    await markEventFailed(eventRowId, "no pending purchase");
    return new NextResponse("success");
  }

  if (pendingPurchase.status === "succeeded") {
    await db.update(eventsWebhook).set({ status: "processed", processedAt: new Date() }).where(eq(eventsWebhook.id, eventRowId));
    return new NextResponse("success");
  }

  if (pendingPurchase.status !== "pending") {
    log(
      "billing.zpay_notify_failed",
      { stage: "invalid_status", outTradeNo, status: pendingPurchase.status },
      { route: ROUTE, requestId, level: "error" },
    );
    await markEventFailed(eventRowId, "invalid purchase status");
    return new NextResponse("success");
  }

  if (
    pendingPurchase.userId !== outUserId ||
    pendingPurchase.productId !== outSkuId ||
    pendingPurchase.currency.toUpperCase() !== "CNY"
  ) {
    log(
      "billing.zpay_notify_failed",
      {
        stage: "purchase_mismatch",
        outTradeNo,
        expectedUserId: pendingPurchase.userId,
        expectedSkuId: pendingPurchase.productId,
        expectedCurrency: pendingPurchase.currency,
        actualUserId: outUserId,
        actualSkuId: outSkuId,
      },
      { route: ROUTE, requestId, level: "error" },
    );
    await markEventFailed(eventRowId, "purchase mismatch");
    return new NextResponse("success");
  }

  const notesGranted = pendingPurchase.notesGranted;
  const moneyCents = parseCnyCents(verified.money);
  if (moneyCents === null || moneyCents !== pendingPurchase.amountCents) {
    log(
      "billing.zpay_notify_failed",
      {
        stage: "amount_mismatch",
        outTradeNo,
        expectedCents: pendingPurchase.amountCents,
        actualCents: moneyCents,
      },
      { route: ROUTE, requestId, level: "error" },
    );
    await markEventFailed(eventRowId, "amount mismatch");
    // The money value is signature-verified, so a mismatch is immutable: a
    // retry would re-fail identically. Ack with 200 (like the other
    // post-lookup validation failures) to stop ZPay's retry loop; the event is
    // recorded as failed for manual review.
    return new NextResponse("success");
  }

  // Grant notes
  const grant = await grantNotes({
    userId: pendingPurchase.userId,
    amount: notesGranted,
    reason: "purchase:topup",
    externalRef: outTradeNo,
    metadata: {
      provider: PROVIDER,
      skuId: pendingPurchase.productId,
      zpayTradeNo: verified.trade_no,
      paymentType: verified.type,
      money: verified.money,
    },
  });

  if (!grant.ok) {
    log("billing.zpay_notify_failed", { stage: "grant", outTradeNo, reason: grant.reason }, { route: ROUTE, requestId, level: "error" });
    await markEventFailed(eventRowId, `grant failed: ${grant.reason}`);
    return new NextResponse("fail", { status: 500 });
  }

  // Mark purchase succeeded and event processed atomically so a mid-flight
  // crash never leaves purchase in "pending" while notes are already granted.
  await db.transaction(async (tx) => {
    await tx
      .update(purchases)
      .set({
        status: "succeeded",
        rawPayload: verified as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, pendingPurchase.id));

    await tx
      .update(eventsWebhook)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(eventsWebhook.id, eventRowId));
  });

  log(
    "notes.granted",
    {
      amount: notesGranted,
      skuId: pendingPurchase.productId,
      duplicate: grant.duplicate,
      orderId: outTradeNo,
      balanceAfter: grant.balanceAfter,
      provider: PROVIDER,
    },
    { route: ROUTE, userId: pendingPurchase.userId, requestId },
  );

  // zpay requires plain text "success" response
  return new NextResponse("success");
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
