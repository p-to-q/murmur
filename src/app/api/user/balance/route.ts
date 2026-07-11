import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { getRequestHostname } from "@/lib/auth/local-preview";
import { resolveRequestAuth } from "@/lib/auth";
import { getDevBalanceFallback, shouldUseDevBalanceFallback } from "@/lib/billing/dev-balance";
import { nextNotesRefillAt } from "@/lib/billing/notes-clock";
import { getNotesBalance } from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/user/balance";
const RATE_LIMIT = { capacity: 60, refillWindowMs: 60_000 };

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) {
    auth.response.headers.set("X-Request-Id", requestId);
    return auth.response;
  }
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

  try {
    const balance = await getNotesBalance(userId);
    if (!balance.ok) {
      return NextResponse.json(
        {
          error: "user_not_found",
          notes: 0,
          accountNotes: 0,
          dailyFreeNotes: 0,
          planTier: "free",
          nextRefillAt: nextNotesRefillAt().toISOString(),
        },
        { status: 404, headers: { "X-Request-Id": requestId } },
      );
    }

    return NextResponse.json({
      notes: balance.notes,
      accountNotes: balance.accountNotes,
      dailyFreeNotes: balance.dailyFreeNotes,
      planTier: balance.planTier,
      nextRefillAt: nextNotesRefillAt().toISOString(),
      unlimited: false,
    }, { headers: { "X-Request-Id": requestId } });
  } catch (error) {
    if (shouldUseDevBalanceFallback({ host: getRequestHostname(request) })) {
      log("user.balance_failed", {
        error: error instanceof Error ? error.message : String(error),
        fallback: "local_demo_snapshot",
      }, {
        route: ROUTE,
        userId,
        sessionId: auth.sessionId,
        level: "warn",
      });
      const fallback = getDevBalanceFallback();
      return NextResponse.json({
        notes: fallback.notes,
        accountNotes: fallback.notes,
        dailyFreeNotes: 0,
        planTier: fallback.planTier,
        nextRefillAt: nextNotesRefillAt().toISOString(),
      }, { headers: { "X-Request-Id": requestId } });
    }

    log("user.balance_failed", {
      error: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
    return NextResponse.json(
      { error: "balance_unavailable" },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }
}
