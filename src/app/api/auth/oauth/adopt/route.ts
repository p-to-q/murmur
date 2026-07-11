import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/auth";
import { createSession, getSessionByToken } from "@/lib/db/queries/sessions";
import {
  getSessionToken,
  murmurSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/platform/server-auth";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/auth/oauth/adopt";
// IP-scoped ceiling: this mints a Murmur session from a provider session, so
// cap adoption churn from any single host.
const OAUTH_ADOPT_RATE_LIMIT = { capacity: 20, refillWindowMs: 60_000 };

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "ip",
    userId: clientIpFromHeaders(request.headers),
    requestId,
    options: OAUTH_ADOPT_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  const session = await auth();
  const oauthUser = session?.user as
    | {
        id?: string;
        email?: string | null;
        name?: string | null;
        image?: string | null;
        accountKind?: "local_creator" | "registered";
        authProvider?: string;
      }
    | undefined;

  if (!oauthUser?.id || oauthUser.id === "guest") {
    return NextResponse.json(
      { error: "oauth_session_required", requestId },
      { status: 401, headers: { "X-Request-Id": requestId } },
    );
  }

  const currentToken = getSessionToken(request);
  if (currentToken) {
    try {
      const currentSession = await getSessionByToken(currentToken);
      if (
        currentSession?.user.id === oauthUser.id &&
        currentSession.user.accountKind !== "local_creator"
      ) {
        return NextResponse.json(
          {
            ok: true,
            adopted: false,
            sessionId: currentSession.sessionId,
            user: currentSession.user,
            authProvider: oauthUser.authProvider ?? null,
            requestId,
          },
          { headers: { "X-Request-Id": requestId } },
        );
      }
    } catch (error) {
      log(
        "auth.oauth_adopt_existing_session_failed",
        { error: error instanceof Error ? error.message : String(error) },
        { route: ROUTE, requestId, userId: oauthUser.id, level: "warn" },
      );
    }
  }

  try {
    const murmurSession = await createSession({
      userId: oauthUser.id,
      shell: "web",
      metadata: {
        userAgent: request.headers.get("user-agent") ?? undefined,
        ip:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
          || request.headers.get("x-real-ip")?.trim()
          || undefined,
      },
    });

    const response = NextResponse.json(
      {
        ok: true,
        adopted: true,
        sessionId: murmurSession.sessionId,
        user: {
          id: oauthUser.id,
          email: oauthUser.email ?? null,
          name: oauthUser.name ?? null,
          avatarUrl: oauthUser.image ?? null,
          accountKind: "registered",
        },
        authProvider: oauthUser.authProvider ?? null,
        requestId,
      },
      { headers: { "X-Request-Id": requestId } },
    );
    response.cookies.set(
      SESSION_COOKIE_NAME,
      murmurSession.token,
      murmurSessionCookieOptions(murmurSession.expiresAt),
    );
    return response;
  } catch (error) {
    log(
      "auth.oauth_adopt_failed",
      { error: error instanceof Error ? error.message : String(error) },
      { route: ROUTE, requestId, userId: oauthUser.id, level: "error" },
    );
    return NextResponse.json(
      { error: "oauth_adoption_failed", requestId },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }
}
