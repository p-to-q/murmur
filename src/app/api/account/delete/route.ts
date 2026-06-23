import { NextRequest, NextResponse } from "next/server";
import {
  clearMurmurSessionCookieOptions,
  resolveRequestAuth,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { requestAccountDeletion } from "@/lib/db/queries/users";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/account/delete";
const AUTH_SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export async function POST(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  if (auth.user.accountKind !== "registered") {
    return NextResponse.json(
      {
        error: "registered_account_required",
        message: "Sign in before requesting account deletion.",
      },
      { status: 403 },
    );
  }

  try {
    const result = await requestAccountDeletion(auth.user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 404 });
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

    const response = NextResponse.json({
      ok: true,
      deletedAt: result.deletedAt.toISOString(),
      revokedSongs: result.revokedSongs,
      revokedSessions: result.revokedSessions,
      alreadyDeleted: result.alreadyDeleted,
    });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    log(
      "account.delete_failed",
      { error: error instanceof Error ? error.message : String(error) },
      {
        route: ROUTE,
        userId: auth.user.id,
        sessionId: auth.sessionId,
        level: "error",
      },
    );
    return NextResponse.json(
      {
        error: "account_delete_unavailable",
        message: "Could not request account deletion right now.",
      },
      { status: 503 },
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
