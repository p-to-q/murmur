import { NextRequest, NextResponse } from "next/server";
import {
  clearMurmurSessionCookieOptions,
  getSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { revokeSessionAndPushByToken } from "@/lib/db/queries/sessions";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";
import { revokeLogoutSession } from "./session-exit";

export const runtime = "nodejs";

const ROUTE = "/api/auth/logout";
// IP-scoped ceiling on this pre-auth endpoint (accepts requests with no valid
// session); generous since legitimate logout traffic is low-volume.
const LOGOUT_RATE_LIMIT = { capacity: 30, refillWindowMs: 60_000 };

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "ip",
    userId: clientIpFromHeaders(request.headers),
    requestId,
    options: LOGOUT_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  const token = getSessionToken(request);
  let revoked = false;
  let disabledPushSubscriptions = 0;

  if (token) {
    try {
      const result = await revokeLogoutSession(token, revokeSessionAndPushByToken);
      revoked = result.revoked;
      disabledPushSubscriptions = result.disabledPushSubscriptions;
    } catch (error) {
      log("auth.logout_failed", {
        error: error instanceof Error ? error.message : String(error),
      }, {
        route: ROUTE,
        requestId,
        level: "error",
      });

      return NextResponse.json(
        {
          error: "logout_unavailable",
          message: "Could not revoke the current session.",
          requestId,
        },
        { status: 503, headers: { "X-Request-Id": requestId } },
      );
    }
  }

  if (revoked) {
    log(
      "auth.session_revoked",
      { reason: "logout", disabledPushSubscriptions },
      { route: ROUTE, requestId },
    );
  }

  const response = NextResponse.json(
    { ok: true, revoked, disabledPushSubscriptions, requestId },
    { headers: { "X-Request-Id": requestId } },
  );
  response.cookies.set(SESSION_COOKIE_NAME, "", clearMurmurSessionCookieOptions());
  return response;
}
