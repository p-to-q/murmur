import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { getRequestHostname } from "@/lib/auth/local-preview";
import { resolveRequestAuth } from "@/lib/auth";
import { buildAuthMePayload } from "@/lib/auth/me-payload";
import { getDevBalanceFallback, shouldUseDevBalanceFallback } from "@/lib/billing/dev-balance";
import { getNotesBalance } from "@/lib/db/queries/notes-ledger";
import { getIdentityProvidersForUser } from "@/lib/db/queries/users";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/auth/me";
const RATE_LIMIT = { capacity: 60, refillWindowMs: 60_000 };

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) {
    auth.response.headers.set("X-Request-Id", requestId);
    return auth.response;
  }

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "read:user",
    userId: auth.user.id,
    requestId,
    sessionId: auth.sessionId,
    options: RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  try {
    const [balance, identityProviders] = await Promise.all([
      getNotesBalance(auth.user.id),
      auth.user.id === "guest" || auth.user.accountKind === "local_creator"
        ? Promise.resolve([])
        : getIdentityProvidersForUser(auth.user.id),
    ]);
    if (!balance.ok) {
      return NextResponse.json(
        {
          error: "user_not_found",
          message: "No billing account exists for the resolved user.",
        },
        { status: 404, headers: { "X-Request-Id": requestId } },
      );
    }

    return NextResponse.json(
      buildAuthMePayload({
        user: auth.user,
        source: auth.source,
        sessionId: auth.sessionId,
        identityProviders,
        balance: {
          notes: balance.notes,
          accountNotes: balance.accountNotes,
          dailyFreeNotes: balance.dailyFreeNotes,
          planTier: balance.planTier,
        },
      }),
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    if (shouldUseDevBalanceFallback({ host: getRequestHostname(request) })) {
      log("auth.me_failed", {
        error: error instanceof Error ? error.message : String(error),
        fallback: "local_demo_snapshot",
      }, {
        route: ROUTE,
        userId: auth.user.id,
        sessionId: auth.sessionId,
        level: "warn",
      });

      const fallback = getDevBalanceFallback();
      return NextResponse.json(
        buildAuthMePayload({
          user: auth.user,
          source: auth.source,
          sessionId: auth.sessionId,
          identityProviders: [],
          balance: fallback,
        }),
        { headers: { "X-Request-Id": requestId } },
      );
    }

    log("auth.me_failed", {
      error: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      userId: auth.user.id,
      sessionId: auth.sessionId,
      level: "error",
    });

    return NextResponse.json(
      {
        error: "me_unavailable",
        message: "Could not resolve the current account snapshot.",
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }
}
