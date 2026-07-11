import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  NotificationPublishError,
  notifications,
} from "@/lib/platform/notifications-server";
import { log } from "@/lib/observability/log";
import { dailyDigestNotificationCopy } from "@/lib/notifications/notification-copy";
import { getRequestId } from "@/lib/api/request-id";

/** Scheduled by `vercel.json#crons`. Authenticated via `CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "server_error", message: "CRON_SECRET is not configured", requestId },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!timingSafeTokenEqual(token, expected)) {
    return NextResponse.json(
      { error: "unauthorized", message: "Invalid or missing authorization", requestId },
      { status: 401, headers: { "X-Request-Id": requestId } },
    );
  }

  try {
    const copy = dailyDigestNotificationCopy("zh");
    const result = await notifications.publishBroadcast({
      title: copy.title,
      body: copy.body,
      data: { source: "cron-daily-digest" },
    });
    return NextResponse.json(result, { headers: { "X-Request-Id": requestId } });
  } catch (err) {
    if (err instanceof NotificationPublishError) {
      return NextResponse.json(
        { error: err.code, message: err.message, requestId },
        {
          status: err.status >= 400 && err.status < 600 ? err.status : 500,
          headers: { "X-Request-Id": requestId },
        },
      );
    }
    log("notifications.publish_failed", {
      error: err instanceof Error ? err.message : String(err),
      source: "cron_daily_digest",
    }, {
      route: "/api/notifications/cron/daily-digest",
      level: "error",
    });
    return NextResponse.json(
      { error: "server_error", message: "publish failed", requestId },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}

function timingSafeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
