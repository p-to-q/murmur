/**
 * POST /api/billing/zpay-notify — zpay async payment callback.
 *
 * zpay sends form-urlencoded params when payment completes.
 * We verify the signature, grant notes, and respond with plain "success".
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getRequestId } from "@/lib/api/request-id";
import { isZpayConfigured, zpayVerifyNotify } from "@/lib/billing/zpay";
import { db } from "@/lib/db/client";
import { eventsWebhook } from "@/lib/db/schema/events-webhook";
import { purchases } from "@/lib/db/schema/purchases";
import { grantNotesInTransaction } from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/billing/zpay-notify";
const PROVIDER = "zpay";

/**
 * Thrown inside the atomic grant+settlement transaction (#319) when the notes
 * grant fails, so the whole transaction rolls back — the purchase stays pending
 * and the ledger is untouched — rather than leaving credit delivered while
 * durable state lags. The handler maps it to a retryable 500.
 */
class ZpayGrantError extends Error {
  constructor(readonly grantReason: string) {
    super(`grant failed: ${grantReason}`);
  }
}

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
  const requestId = getRequestId(request);

  if (!isZpayConfigured()) {
    return zpayResponse("zpay not configured", requestId, 503);
  }

  const body = await request.text();
  const params = parseUniqueFormParams(body);
  if (!params) {
    log("billing.zpay_notify_failed", { stage: "params" }, { route: ROUTE, requestId, level: "warn" });
    return zpayResponse("fail", requestId, 400);
  }

  const verified = zpayVerifyNotify(params);
  if (!verified) {
    log("billing.zpay_notify_failed", { stage: "signature" }, { route: ROUTE, requestId, level: "warn" });
    return zpayResponse("fail", requestId, 401);
  }

  // Only TRADE_SUCCESS proceeds to fulfillment below. For every other status
  // we must decide whether to acknowledge (ZPay treats an HTTP 200 "success"
  // body as "stop retrying") or ask ZPay to redeliver later (any non-200).
  //
  // ASSUMPTION — verify against ZPay's docs before deploy: the exact
  // trade_status vocabulary and ZPay's retry semantics are not documented
  // anywhere in this codebase (only TRADE_SUCCESS appears today). We treat
  // TRADE_CLOSED / TRADE_FINISHED as terminal (ack, so ZPay stops retrying)
  // and default EVERY other/unknown status (e.g. WAIT_BUYER_PAY) to a 202 so
  // ZPay redelivers once the payment settles. Unknown-status-defaults-to-retry
  // is the safe bias: a spurious retry is cheap (the fulfillment path is
  // idempotent) while a silently-dropped settlement is not.
  if (verified.trade_status !== "TRADE_SUCCESS") {
    const terminal =
      verified.trade_status === "TRADE_CLOSED" ||
      verified.trade_status === "TRADE_FINISHED";
    log(
      "billing.zpay_notify_failed",
      { stage: "non_success_status", trade_status: verified.trade_status, terminal },
      { route: ROUTE, requestId, level: "warn" },
    );
    if (terminal) {
      return zpayResponse("success", requestId);
    }
    return zpayResponse("pending", requestId, 202);
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
    return zpayResponse("success", requestId);
  }

  const eventRowId = eventRow.id;

  // The provider id is opaque. User, SKU, amount, and currency provenance all
  // come from the purchase row created before checkout handoff.
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
    .limit(1)
    // Defense-in-depth only (#231): the real double-grant guard is the
    // idempotent, row-locked grant keyed on the stable out_trade_no
    // externalRef. This FOR UPDATE narrows the window for two concurrent
    // redeliveries to both read status="pending" before either flips it.
    .for("update");

  if (!pendingPurchase) {
    log("billing.zpay_notify_failed", { stage: "no_pending", outTradeNo }, { route: ROUTE, requestId, level: "error" });
    await markEventFailed(eventRowId, "no pending purchase");
    return zpayResponse("success", requestId);
  }

  if (pendingPurchase.status === "succeeded") {
    await db.update(eventsWebhook).set({ status: "processed", processedAt: new Date() }).where(eq(eventsWebhook.id, eventRowId));
    return zpayResponse("success", requestId);
  }

  if (pendingPurchase.status !== "pending") {
    log(
      "billing.zpay_notify_failed",
      { stage: "invalid_status", outTradeNo, status: pendingPurchase.status },
      { route: ROUTE, requestId, level: "error" },
    );
    await markEventFailed(eventRowId, "invalid purchase status");
    return zpayResponse("success", requestId);
  }

  if (pendingPurchase.currency.toUpperCase() !== "CNY") {
    log(
      "billing.zpay_notify_failed",
      {
        stage: "currency_mismatch",
        outTradeNo,
        expectedCurrency: pendingPurchase.currency,
      },
      { route: ROUTE, requestId, level: "error" },
    );
    await markEventFailed(eventRowId, "purchase currency mismatch");
    return zpayResponse("success", requestId);
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
    return zpayResponse("success", requestId);
  }

  // Grant notes AND settle the purchase + webhook event in ONE transaction
  // (#319). Before, the grant committed in its own transaction and the
  // purchase/event updates followed separately, so a crash in between could
  // leave credit delivered while the durable purchase/event state stayed
  // "pending" — recoverable only if the provider happened to redeliver. Folding
  // the grant into the settlement transaction makes "notes granted" and
  // "purchase/event processed" atomic: either all three land or none do.
  //
  // Idempotency is preserved: grantNotesInTransaction dedupes on the
  // (userId, purchase:topup, out_trade_no) ledger index under the user row
  // lock, so a redelivery re-runs the transaction, hits the existing grant
  // (duplicate: true), and re-applies the same terminal purchase/event state.
  let grant: Awaited<ReturnType<typeof grantNotesInTransaction>>;
  try {
    grant = await db.transaction(async (tx) => {
      const result = await grantNotesInTransaction(tx, {
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

      // Throw inside the transaction so a failed grant rolls the purchase +
      // event settlement back with it — the whole point of #319.
      if (!result.ok) {
        throw new ZpayGrantError(result.reason);
      }

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

      return result;
    });
  } catch (error) {
    if (error instanceof ZpayGrantError) {
      log("billing.zpay_notify_failed", { stage: "grant", outTradeNo, reason: error.grantReason }, { route: ROUTE, requestId, level: "error" });
      await markEventFailed(eventRowId, error.message);
      return zpayResponse("fail", requestId, 500);
    }
    // A settlement failure (e.g. the purchase/event UPDATE) also rolls back the
    // grant. Surface a retryable 500 and record the event as failed so a ZPay
    // redelivery — or the reconcile cron — can complete it later.
    const message = error instanceof Error ? error.message : String(error);
    log("billing.zpay_notify_failed", { stage: "settlement", outTradeNo, error: message }, { route: ROUTE, requestId, level: "error" });
    await markEventFailed(eventRowId, `settlement failed: ${message}`).catch(() => {});
    return zpayResponse("fail", requestId, 500);
  }

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
  return zpayResponse("success", requestId);
}

function zpayResponse(
  body: string,
  requestId: string,
  status = 200,
): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "X-Request-Id": requestId },
  });
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
