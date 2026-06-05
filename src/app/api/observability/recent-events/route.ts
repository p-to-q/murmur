import { NextRequest, NextResponse } from "next/server";
import { resolveRequestAuth } from "@/lib/auth";
import { getRecentEvents } from "@/lib/observability/recent-events";

export const runtime = "nodejs";

/**
 * GET /api/observability/recent-events
 *
 * Dev / single-instance debugging surface for the audio pipeline.
 * Returns the last N transcribe / capture / arrangement events captured
 * by the typed `log()` helper in this Node process. Documented in
 * `docs/observability.md` §8.
 *
 * Gating: refuses to serve in production unless
 * `MURMUR_ENABLE_DEBUG_SURFACE=true`, so the buffer never accidentally
 * leaks to a real user. The buffer itself already redacts raw / audio
 * fields, but the gate is the second line of defense.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isDebugSurfaceEnabled()) {
    return NextResponse.json(
      { error: "forbidden", message: "Debug surface disabled" },
      { status: 403 },
    );
  }

  const auth = await resolveRequestAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "unauthorized", message: "Authentication required" },
      { status: 401 },
    );
  }
  if (auth.source === "guest") {
    return NextResponse.json(
      { error: "forbidden", message: "Debug surface requires a signed-in session" },
      { status: 403 },
    );
  }

  return NextResponse.json({
    events: getRecentEvents(),
    captured_at: new Date().toISOString(),
  });
}

function isDebugSurfaceEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const flag = process.env.MURMUR_ENABLE_DEBUG_SURFACE?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}
