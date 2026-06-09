import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { upsertUser } from "@/lib/db/queries";
import { log } from "@/lib/observability/log";

/**
 * GET /api/user/profile
 * Reads the local platform user headers and returns the current profile.
 * Also upserts the user into the local DB so user info is always up to date.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;

  const { user } = auth;

  // Upsert in the background — don't block the response on DB latency.
  upsertUser({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  }).catch((err) => {
    log("user.profile_failed", {
      error: err instanceof Error ? err.message : String(err),
      stage: "upsert_user",
    }, {
      route: "/api/user/profile",
      userId: user.id,
      level: "error",
    });
  });

  return NextResponse.json({ ok: true, user });
}
