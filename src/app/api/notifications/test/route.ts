import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveRequestAuth } from "@/lib/auth";
import {
  NotificationPublishError,
  notifications,
} from "@/lib/platform/notifications-server";
import { log } from "@/lib/observability/log";
import {
  langFromAcceptLanguage,
  pushTestNotificationCopy,
} from "@/lib/notifications/notification-copy";

const testNotificationSchema = z.object({
  notificationId: z.string().min(1).max(120).optional(),
});

/**
 * Sends a test notification through the local platform adapter.
 * The standalone app currently returns a stubbed publish result unless
 * a real push gateway is wired in behind the adapter.
 */
export async function POST(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof testNotificationSchema> = {};
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      body = testNotificationSchema.parse(await request.json());
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "validation_error",
        message: "Invalid test notification payload",
        issues: error instanceof z.ZodError ? error.issues : undefined,
      },
      { status: 400 },
    );
  }

  const callerLabel =
    auth.user.name?.trim() || auth.user.email?.split("@")[0] || "there";
  const notificationId = body.notificationId;
  const lang = langFromAcceptLanguage(request.headers.get("accept-language"));
  const copy = pushTestNotificationCopy(lang, callerLabel);

  const requestId = crypto.randomUUID();

  try {
    const result = await notifications.publish({
      title: copy.title,
      body: copy.body,
      userId: auth.user.id,
      data: {
        kind: "system",
        tag: "murmur-notification-test",
        href: "/me/notifications",
        source: "test-button",
        sourceId: notificationId,
        notificationId,
        triggeredByUserId: auth.user.id,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotificationPublishError) {
      return NextResponse.json(
        { error: err.code, message: err.message, requestId },
        { status: err.status >= 400 && err.status < 600 ? err.status : 500 },
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
    return NextResponse.json(
      { error: "server_error", message: "publish failed", requestId },
      { status: 500 },
    );
  }
}
