import { NextRequest, NextResponse } from "next/server";
import { resolveRequestAuth } from "@/lib/auth";
import { nextNotesRefillAt } from "@/lib/billing/notes-clock";
import { getNotesBalance } from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/user/balance";

export async function GET(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  try {
    const balance = await getNotesBalance(userId);
    if (!balance.ok) {
      return NextResponse.json(
        {
          error: "user_not_found",
          notes: 0,
          planTier: "free",
          nextRefillAt: nextNotesRefillAt().toISOString(),
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      notes: balance.notes,
      planTier: balance.planTier,
      nextRefillAt: nextNotesRefillAt().toISOString(),
    });
  } catch (error) {
    log("user.balance_failed", {
      error: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
    return NextResponse.json(
      { error: "balance_unavailable" },
      { status: 503 },
    );
  }
}
