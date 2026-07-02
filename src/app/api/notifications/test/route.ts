import { type NextRequest, NextResponse } from "next/server";
import { resolveRequestAuth } from "@/lib/auth";
import {
  NotificationPublishError,
  notifications,
} from "@/lib/platform/notifications-server";
import { log } from "@/lib/observability/log";

/**
 * Sends a test notification through the local platform adapter.
 * The standalone app currently returns a stubbed publish result unless
 * a real push gateway is wired in behind the adapter.
 */
export async function POST(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  const callerLabel =
    auth.user.name?.trim() || auth.user.email?.split("@")[0] || "there";

  try {
    const result = await notifications.publish({
      title: `Hello, ${callerLabel} 👋`,
      body: "This is a local notification preflight from Murmur.",
      userId: auth.user.id,
      data: {
        kind: "system",
        tag: "murmur-notification-test",
        href: "/me/notifications",
        source: "test-button",
        triggeredByUserId: auth.user.id,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotificationPublishError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code >= 400 && err.code < 600 ? err.code : 500 },
      );
    }
    log("notifications.publish_failed", {
      error: err instanceof Error ? err.message : String(err),
      source: "test_button",
    }, {
      route: "/api/notifications/test",
      userId: auth.user.id,
      level: "error",
    });
    return NextResponse.json({ error: "publish failed" }, { status: 500 });
  }
}
