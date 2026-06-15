import { NextRequest, NextResponse } from "next/server";

import { resolveRequestAuth } from "@/lib/auth";
import { shouldUseDevBalanceFallback } from "@/lib/billing/dev-balance";
import { getTopupSurfaceSnapshot } from "@/lib/db/queries/topup-surface";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/user/topup-surface";

export async function GET(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

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
};

function serializeSnapshot(snapshot: SnapshotLike) {
  return {
    lifetimeTopupCents: snapshot.lifetimeTopupCents,
  };
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
