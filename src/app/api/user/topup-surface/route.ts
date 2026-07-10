import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { getRequestHostname } from "@/lib/auth/local-preview";

import { resolveRequestAuth } from "@/lib/auth";
import { shouldUseDevBalanceFallback } from "@/lib/billing/dev-balance";
import { getTopupSurfaceSnapshot } from "@/lib/db/queries/topup-surface";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/user/topup-surface";
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

  try {
    const snapshot = await getTopupSurfaceSnapshot(userId);
    return NextResponse.json(serializeSnapshot(snapshot));
  } catch (error) {
    if (shouldUseDevBalanceFallback({ host: getRequestHostname(request) })) {
      log("user.balance_failed", {
        surface: "topup",
        error: error instanceof Error ? error.message : String(error),
        fallback: "local_demo_snapshot",
      }, {
        route: ROUTE,
        userId,
        sessionId: auth.sessionId,
        level: "warn",
      });
      return NextResponse.json(serializeSnapshot({
        lifetimeTopupCents: 0,
        latestPlanSkuId: null,
      }));
    }

    log("user.balance_failed", {
      surface: "topup",
      error: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });

    return NextResponse.json(
      { error: "topup_surface_unavailable" },
      { status: 503 },
    );
  }
}

type SnapshotLike = {
  lifetimeTopupCents: number;
  latestPlanSkuId: string | null;
};

function serializeSnapshot(snapshot: SnapshotLike) {
  return {
    lifetimeTopupCents: snapshot.lifetimeTopupCents,
    latestPlanSkuId: snapshot.latestPlanSkuId,
  };
}

