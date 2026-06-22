import { NextRequest, NextResponse } from "next/server";
import { resolveRequestAuth } from "@/lib/auth";
import { buildAuthMePayload } from "@/lib/auth/me-payload";
import { getDevBalanceFallback, shouldUseDevBalanceFallback } from "@/lib/billing/dev-balance";
import { getNotesBalance } from "@/lib/db/queries/notes-ledger";
import { getIdentityProvidersForUser } from "@/lib/db/queries/users";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/auth/me";

export async function GET(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

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
        { status: 404 },
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
      { status: 503 },
    );
  }
}

function getRequestHostname(request: NextRequest): string | null {
  const nextUrl = (request as { nextUrl?: { hostname?: string } }).nextUrl;
  if (nextUrl?.hostname) return nextUrl.hostname;

  try {
    return new URL(request.url).hostname;
  } catch {
    return null;
  }
}
