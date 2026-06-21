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

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  if (!isZpayConfigured()) {
    return new NextResponse("zpay not configured", { status: 503 });
  }

  const body = await request.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) {
    params[k] = v;
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

  const insertedRows = await db
    .insert(eventsWebhook)
    .values({
      id: newId("evw"),
      provider: PROVIDER,
      providerEventId: `zpay:${verified.trade_no}`,
      routeId: "billing.webhook.zpay",
      status: "received",
      signatureOk: true,
      rawPayload: verified as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({
      target: [eventsWebhook.provider, eventsWebhook.providerEventId],
    })
    .returning({ id: eventsWebhook.id });

  if (insertedRows.length === 0) {
    return new NextResponse("success");
  }

  const eventRowId = insertedRows[0]!.id;

  // Parse our out_trade_no format: {userId}:{skuId}:{uuid}
  const parts = outTradeNo.split(":");
  if (parts.length < 3) {
    log("billing.zpay_notify_failed", { stage: "parse", outTradeNo }, { route: ROUTE, requestId, level: "error" });
    await db.update(eventsWebhook).set({ status: "failed", processedAt: new Date(), error: "invalid out_trade_no format" }).where(eq(eventsWebhook.id, eventRowId));
    return new NextResponse("success");
  }

  const userId = parts[0]!;
  const skuId = parts[1]!;
  const moneyCents = Math.round(parseFloat(verified.money) * 100);

  // Resolve notes from the pending_zpay_orders metadata stored at checkout time
  // We look up the purchase record created during checkout
  const [pendingPurchase] = await db
    .select({
      id: purchases.id,
      notesGranted: purchases.notesGranted,
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
    await db.update(eventsWebhook).set({ status: "failed", processedAt: new Date(), error: "no pending purchase" }).where(eq(eventsWebhook.id, eventRowId));
    return new NextResponse("success");
  }

  if (pendingPurchase.status === "succeeded") {
    await db.update(eventsWebhook).set({ status: "processed", processedAt: new Date() }).where(eq(eventsWebhook.id, eventRowId));
    return new NextResponse("success");
  }

  const notesGranted = pendingPurchase.notesGranted;

  // Grant notes
  const grant = await grantNotes({
    userId,
    amount: notesGranted,
    reason: "purchase:topup",
    externalRef: outTradeNo,
    metadata: {
      provider: PROVIDER,
      skuId,
      zpayTradeNo: verified.trade_no,
      paymentType: verified.type,
      money: verified.money,
    },
  });

  if (!grant.ok) {
    log("billing.zpay_notify_failed", { stage: "grant", outTradeNo, reason: grant.reason }, { route: ROUTE, requestId, level: "error" });
    await db.update(eventsWebhook).set({ status: "failed", processedAt: new Date(), error: `grant failed: ${grant.reason}` }).where(eq(eventsWebhook.id, eventRowId));
    return new NextResponse("fail", { status: 500 });
  }

  // Mark purchase as succeeded
  await db
    .update(purchases)
    .set({
      status: "succeeded",
      rawPayload: verified as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(purchases.id, pendingPurchase.id));

  await db.update(eventsWebhook).set({ status: "processed", processedAt: new Date() }).where(eq(eventsWebhook.id, eventRowId));

  log(
    "notes.granted",
    {
      amount: notesGranted,
      skuId,
      duplicate: grant.duplicate,
      orderId: outTradeNo,
      balanceAfter: grant.balanceAfter,
      provider: PROVIDER,
    },
    { route: ROUTE, userId, requestId },
  );

  // zpay requires plain text "success" response
  return new NextResponse("success");
}
