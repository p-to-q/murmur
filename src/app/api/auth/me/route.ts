import { NextRequest, NextResponse } from "next/server";
import { resolveRequestAuth } from "@/lib/auth";
import { buildAuthMePayload } from "@/lib/auth/me-payload";
import { getNotesBalance } from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/auth/me";

export async function GET(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const balance = await getNotesBalance(auth.user.id);
    if (!balance.ok) {
      return NextResponse.json(
        {
          error: "user_not_found",
          message: "No billing account exists for the resolved user.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      buildAuthMePayload({
        user: auth.user,
        source: auth.source,
        sessionId: auth.sessionId,
        balance: {
          notes: balance.notes,
          planTier: balance.planTier,
        },
      }),
    );
  } catch (error) {
    log("auth.me_failed", {
      error: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      userId: auth.user.id,
      sessionId: auth.sessionId,
      level: "error",
    });

    return NextResponse.json(
      {
        error: "me_unavailable",
        message: "Could not resolve the current account snapshot.",
      },
      { status: 503 },
    );
  }
}
