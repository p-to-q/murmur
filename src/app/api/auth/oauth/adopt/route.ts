import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/auth";
import { createSession, getSessionByToken } from "@/lib/db/queries/sessions";
import {
  getSessionToken,
  murmurSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/platform/server-auth";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/auth/oauth/adopt";

export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: "oauth_session_required" }, { status: 401 });
  }

  const currentToken = getSessionToken(request);
  if (currentToken) {
    try {
      const currentSession = await getSessionByToken(currentToken);
      if (
        currentSession?.user.id === oauthUser.id &&
        currentSession.user.accountKind !== "local_creator"
      ) {
        return NextResponse.json({
          ok: true,
          adopted: false,
          sessionId: currentSession.sessionId,
          user: currentSession.user,
          authProvider: oauthUser.authProvider ?? null,
        });
      }
    } catch (error) {
      log(
        "auth.oauth_adopt_existing_session_failed",
        { error: error instanceof Error ? error.message : String(error) },
        { route: ROUTE, userId: oauthUser.id, level: "warn" },
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

    const response = NextResponse.json({
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
    });
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
      { route: ROUTE, userId: oauthUser.id, level: "error" },
    );
    return NextResponse.json({ error: "oauth_adoption_failed" }, { status: 503 });
  }
}
