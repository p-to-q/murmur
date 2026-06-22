import { NextRequest, NextResponse } from "next/server";
import {
  clearMurmurSessionCookieOptions,
  getSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { revokeSessionByToken } from "@/lib/db/queries/sessions";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/auth/logout";

export async function POST(request: NextRequest) {
  const token = getSessionToken(request);
  let revoked = false;

  if (token) {
    try {
      revoked = await revokeSessionByToken(token);
    } catch (error) {
      log("auth.logout_failed", {
        error: error instanceof Error ? error.message : String(error),
      }, {
        route: ROUTE,
        level: "error",
      });

      return NextResponse.json(
        {
          error: "logout_unavailable",
          message: "Could not revoke the current session.",
        },
        { status: 503 },
      );
    }
  }

  if (revoked) {
    log("auth.session_revoked", { reason: "logout" }, { route: ROUTE });
  }

  const response = NextResponse.json({ ok: true, revoked });
  response.cookies.set(SESSION_COOKIE_NAME, "", clearMurmurSessionCookieOptions());
  return response;
}
