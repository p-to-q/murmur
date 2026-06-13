/**
 * POST /api/purchases/restore
 *
 * Returns local Waffo / web purchase records for the signed-in user.
 * Waffo does not expose a Stripe-style session list API in this route;
 * webhook + local DB are the source of truth.
 */

import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { purchases } from "@/lib/db/schema/purchases";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/purchases/restore";
const RESTORE_RATE_LIMIT = { capacity: 5, refillWindowMs: 60 * 60 * 1000 };

interface RestoredPurchase {
  id: string;
  productId: string;
  provider: string;
  notesGranted: number;
  createdAt: Date;
}

interface RestoreResponse {
  restored: RestoredPurchase[];
  totalNotes: number;
  newPurchases: number;
}

async function listExistingPurchases(userId: string): Promise<RestoredPurchase[]> {
  const existingPurchases = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.status, "succeeded"),
      ),
    )
    .orderBy(desc(purchases.createdAt))
    .limit(100);

  return existingPurchases.map((purchase) => ({
    id: purchase.id,
    productId: purchase.productId,
    provider: purchase.provider,
    notesGranted: purchase.notesGranted,
    createdAt: purchase.createdAt,
  }));
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  if (userId === "guest") {
    return NextResponse.json(
      {
        error: "sign_in_required",
        message: "Sign in before restoring purchases.",
        requestId,
      },
      { status: 403, headers: { "X-Request-Id": requestId } },
    );
  }

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "restore",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: RESTORE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  try {
    const restored = await listExistingPurchases(userId);
    const response: RestoreResponse = {
      restored,
      totalNotes: restored.reduce((sum, purchase) => sum + purchase.notesGranted, 0),
      newPurchases: 0,
    };

    return NextResponse.json(response, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (error) {
    log(
      "purchases.restore_failed",
      {
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
        error: "restore_failed",
        message: "Failed to restore purchases. Please try again later.",
        requestId,
      },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}
