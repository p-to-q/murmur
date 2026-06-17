import { type NextRequest, NextResponse } from "next/server";
import { resolveRequestAuth } from "@/lib/auth";
import { upsertUser } from "@/lib/db/queries";
import { log } from "@/lib/observability/log";

/**
 * GET /api/user/profile
 * Returns the session-resolved profile. Local/demo header identities are
 * accepted only when the auth resolver explicitly allows fallbacks.
 */
export async function GET(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  const { user } = auth;

  // Await the upsert: on serverless the instance can freeze as soon as the
  // response returns, so a fire-and-forget write is not guaranteed to land.
  // The latency cost is one indexed upsert on a rarely-hit route.
  try {
    await upsertUser({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });
  } catch (err) {
    log("user.profile_failed", {
      error: err instanceof Error ? err.message : String(err),
      stage: "upsert_user",
    }, {
      route: "/api/user/profile",
      userId: user.id,
      level: "error",
    });
  }

  return NextResponse.json({ ok: true, user });
}
