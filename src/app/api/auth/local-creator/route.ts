import { NextRequest, NextResponse } from "next/server";
import { LOCAL_CREATOR_FREE_NOTES } from "@murmur/core";
import { SESSION_COOKIE_NAME, resolveRequestAuth } from "@/lib/auth";
import { createSession } from "@/lib/db/queries/sessions";
import { createLocalCreatorUser } from "@/lib/db/queries/users";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/auth/local-creator";

export async function POST(request: NextRequest) {
  const auth = await resolveRequestAuth(request, { allowGuestPreview: true });
  if (auth.ok && auth.source !== "guest" && auth.user.id !== "guest") {
    return NextResponse.json({
      user: auth.user,
      source: auth.source,
      sessionId: auth.sessionId,
      created: false,
    });
  }

  try {
    const user = await createLocalCreatorUser();
    const session = await createSession({
      userId: user.id,
      shell: "web",
      metadata: {
        userAgent: request.headers.get("user-agent") ?? undefined,
        ip: getForwardedIp(request),
      },
    });

    log(
      "auth.local_creator_created",
      { notes: LOCAL_CREATOR_FREE_NOTES },
      { route: ROUTE, userId: user.id, sessionId: session.sessionId },
    );

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: session.sessionId,
      created: true,
    });
    response.cookies.set(SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt,
      maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    log(
      "auth.local_creator_failed",
      { error: error instanceof Error ? error.message : String(error) },
      { route: ROUTE, level: "error" },
    );
    return NextResponse.json(
      {
        error: "local_creator_unavailable",
        message: "Could not create a Local Creator account.",
      },
      { status: 503 },
    );
  }
}

function getForwardedIp(request: NextRequest): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || undefined
  );
}
