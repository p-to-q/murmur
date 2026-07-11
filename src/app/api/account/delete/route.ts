import { NextRequest, NextResponse } from "next/server";
import { resolveRequestAuth } from "@/lib/auth";
import {
  clearMurmurSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/platform/server-auth";
import { requestAccountDeletion } from "@/lib/db/queries/users";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/account/delete";
// User-scoped ceiling on an irreversible, auth-gated action; low by design.
const DELETE_RATE_LIMIT = { capacity: 3, refillWindowMs: 60 * 60 * 1000 };
const AUTH_SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "user",
    userId: auth.user.id,
    requestId,
    sessionId: auth.sessionId,
    options: DELETE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  if (auth.user.accountKind !== "registered") {
    return NextResponse.json(
      {
        error: "registered_account_required",
        message: "Sign in before requesting account deletion.",
        requestId,
      },
      { status: 403, headers: { "X-Request-Id": requestId } },
    );
  }

  try {
    const result = await requestAccountDeletion(auth.user.id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, requestId },
        { status: 404, headers: { "X-Request-Id": requestId } },
      );
    }

    log(
      "account.delete_requested",
      {
        revokedSongs: result.revokedSongs,
        revokedSessions: result.revokedSessions,
        alreadyDeleted: result.alreadyDeleted,
      },
      {
        route: ROUTE,
        userId: auth.user.id,
        sessionId: auth.sessionId,
      },
    );

    const response = NextResponse.json(
      {
        ok: true,
        deletedAt: result.deletedAt.toISOString(),
        revokedSongs: result.revokedSongs,
        revokedSessions: result.revokedSessions,
        alreadyDeleted: result.alreadyDeleted,
        requestId,
      },
      { headers: { "X-Request-Id": requestId } },
    );
    clearSessionCookies(response);
    return response;
  } catch (error) {
    log(
      "account.delete_failed",
      { error: error instanceof Error ? error.message : String(error) },
      {
        route: ROUTE,
        requestId,
        userId: auth.user.id,
        sessionId: auth.sessionId,
        level: "error",
      },
    );
    return NextResponse.json(
      {
        error: "account_delete_unavailable",
        message: "Could not request account deletion right now.",
        requestId,
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }
}

function clearSessionCookies(response: NextResponse): void {
  response.cookies.set(
    SESSION_COOKIE_NAME,
    "",
    clearMurmurSessionCookieOptions(),
  );

  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  };

  for (const name of AUTH_SESSION_COOKIE_NAMES) {
    response.cookies.set(name, "", options);
    for (let index = 0; index < 5; index += 1) {
      response.cookies.set(`${name}.${index}`, "", options);
    }
  }
}
