/**
 * GET /api/user/payments
 *
 * Signed-in user's local payment records. Waffo web payments are webhook-backed;
 * this endpoint deliberately exposes only the safe receipt summary, not raw
 * provider payloads.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { purchases } from "@/lib/db/schema/purchases";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/user/payments";
const RATE_LIMIT = { capacity: 60, refillWindowMs: 60_000 };

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "read:user",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  if (userId === "guest") {
    return NextResponse.json(
      {
        error: "sign_in_required",
        message: "Sign in to view payment records.",
        requestId,
      },
      { status: 403, headers: { "X-Request-Id": requestId } },
    );
  }

  try {
    const rows = await db
      .select({
        id: purchases.id,
        provider: purchases.provider,
        productId: purchases.productId,
        providerRef: purchases.providerRef,
        amountCents: purchases.amountCents,
        currency: purchases.currency,
        notesGranted: purchases.notesGranted,
        status: purchases.status,
        createdAt: purchases.createdAt,
        updatedAt: purchases.updatedAt,
      })
      .from(purchases)
      .where(and(eq(purchases.userId, userId), inArray(purchases.provider, ["waffo", "zpay"])))
      .orderBy(desc(purchases.createdAt))
      .limit(100);

    return NextResponse.json(
      {
        payments: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        requestId,
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    log(
      "purchases.restore_failed",
      {
        surface: "user.payments",
        error: error instanceof Error ? error.message : String(error),
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
        error: "payments_unavailable",
        message: "Payment records are unavailable right now.",
        requestId,
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }
}
