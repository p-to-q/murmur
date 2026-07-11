import { type NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import { upsertUser } from "@/lib/db/queries";
import { log } from "@/lib/observability/log";

const ROUTE = "/api/user/profile";
const RATE_LIMIT = { capacity: 60, refillWindowMs: 60_000 };

/**
 * GET /api/user/profile
 * Returns the session-resolved profile. Local/demo header identities are
 * accepted only when the auth resolver explicitly allows fallbacks.
 */
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

  const { user } = auth;

  // Await the upsert: on serverless the instance can freeze as soon as the
  // response returns, so a fire-and-forget write is not guaranteed to land.
  // The latency cost is one indexed upsert on a rarely-hit route.
  try {
    await upsertUser({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });
  } catch (err) {
    log("user.profile_failed", {
      error: err instanceof Error ? err.message : String(err),
      stage: "upsert_user",
    }, {
      route: "/api/user/profile",
      userId: user.id,
      level: "error",
    });
  }

  return NextResponse.json({ ok: true, user }, { headers: { "X-Request-Id": requestId } });
}
