/**
 * POST /api/purchases/restore
 *
 * Reconciles Stripe-backed top-up purchases for the current signed-in user.
 *
 * Current scope is intentionally narrow and honest:
 * - Web / Stripe purchases are restorable here.
 * - Native store restore flows (Apple / Google / RevenueCat) are not wired in
 *   this repository yet and should be handled by their shell-native purchase
 *   SDK once that substrate lands.
 *
 * The route is idempotent:
 * - purchases(provider, providerRef) de-duplicates restored purchase rows
 * - notes_ledger(userId, reason, externalRef) de-duplicates grants
 */

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { getStripeClient } from "@/lib/billing/stripe";
import {
  InvalidTopupPurchaseError,
  resolveStripeTopupPurchase,
} from "@/lib/billing/topup-purchase";
import { db } from "@/lib/db/client";
import { grantNotes } from "@/lib/db/queries/notes-ledger";
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

function newPurchaseId(): string {
  return `pur_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
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

async function listStripeSessionsForUser(
  stripe: Stripe,
  email: string | null,
): Promise<Stripe.Checkout.Session[]> {
  const sessions: Stripe.Checkout.Session[] = [];
  const seen = new Set<string>();

  for await (const session of stripe.checkout.sessions.list({
    limit: 100,
  })) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    if (session.payment_status !== "paid") continue;
    const sessionEmail = session.customer_details?.email ?? null;
    if (!session.metadata?.userId && !sessionEmail) continue;
    if (email && sessionEmail && sessionEmail !== email) continue;
    sessions.push(session);
  }

  return sessions;
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

  const stripe = getStripeClient();
  if (!stripe) {
    const restored = await listExistingPurchases(userId);
    return NextResponse.json(
      {
        restored,
        totalNotes: restored.reduce((sum, purchase) => sum + purchase.notesGranted, 0),
        newPurchases: 0,
        requestId,
      },
      { headers: { "X-Request-Id": requestId } },
    );
  }

  try {
    const sessions = await listStripeSessionsForUser(stripe, auth.user.email ?? null);
    let newPurchases = 0;

    for (const session of sessions) {
      try {
        const purchase = resolveStripeTopupPurchase(session);
        if (purchase.userId !== userId) continue;

        const insertResult = await db
          .insert(purchases)
          .values({
            id: newPurchaseId(),
            userId,
            provider: "stripe",
            productId: purchase.productId,
            providerRef: session.id,
            amountCents: purchase.amountCents,
            currency: purchase.currency,
            notesGranted: purchase.notesGranted,
            status: "succeeded",
            rawPayload: session as unknown as Record<string, unknown>,
          })
          .onConflictDoNothing({
            target: [purchases.provider, purchases.providerRef],
          })
          .returning({ id: purchases.id });

        const grant = await grantNotes({
          userId,
          amount: purchase.notesGranted,
          reason: "purchase:topup",
          externalRef: session.id,
          metadata: {
            provider: "stripe",
            ...purchase.metadata,
            checkoutSessionId: session.id,
            paymentIntent: purchase.paymentIntentId,
            restoredBy: "restore_route",
          },
        });

        if (!grant.ok) {
          throw new Error(
            `grantNotes failed for ${userId} on restored session ${session.id}: ${grant.reason}`,
          );
        }

        if (insertResult.length > 0) {
          newPurchases += 1;
        }
      } catch (error) {
        if (error instanceof InvalidTopupPurchaseError) {
          log("purchases.restore_failed", {
            stage: "session_parse",
            sessionId: session.id,
            error: error.message,
          }, {
            route: ROUTE,
            requestId,
            userId,
            sessionId: auth.sessionId,
            level: "warn",
          });
          continue;
        }
        throw error;
      }
    }

    const restored = await listExistingPurchases(userId);
    const response: RestoreResponse = {
      restored,
      totalNotes: restored.reduce((sum, purchase) => sum + purchase.notesGranted, 0),
      newPurchases,
    };

    return NextResponse.json(response, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (error) {
    log("purchases.restore_failed", {
      error: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });

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
