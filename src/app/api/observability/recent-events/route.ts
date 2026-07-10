import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import {
  canAccessDebugSurface,
  debugSurfaceDisabledResponse,
  debugSurfaceForbiddenResponse,
  debugSurfaceUnauthorizedResponse,
  isDebugSurfaceEnabled,
} from "@/lib/observability/debug-surface";
import { getRecentEvents } from "@/lib/observability/recent-events";

export const runtime = "nodejs";

/**
 * GET /api/observability/recent-events
 *
 * Dev / single-instance debugging surface for the audio pipeline.
 * Returns the last N transcribe / capture / arrangement events captured
 * by the typed `log()` helper in this Node process. Documented in
 * `docs/observability.md` §8.
 *
 * Gating: refuses to serve in production unless
 * `MURMUR_ENABLE_DEBUG_SURFACE=true`, so the buffer never accidentally
 * leaks to a real user. The buffer itself already redacts raw / audio
 * fields, but the gate is the second line of defense.
 */
const ROUTE = "/api/observability/recent-events";
const RATE_LIMIT = { capacity: 60, refillWindowMs: 60_000 };

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isDebugSurfaceEnabled()) {
    return debugSurfaceDisabledResponse();
  }

  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) {
    return debugSurfaceUnauthorizedResponse();
  }
  if (!canAccessDebugSurface(auth, request)) {
    return debugSurfaceForbiddenResponse();
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

  return NextResponse.json({
    events: getRecentEvents(),
    captured_at: new Date().toISOString(),
  });
}
