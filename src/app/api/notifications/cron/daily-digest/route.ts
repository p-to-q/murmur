import { type NextRequest, NextResponse } from "next/server";
import {
  NotificationPublishError,
  notifications,
} from "@/lib/platform/notifications-server";
import { log } from "@/lib/observability/log";

/** Scheduled by `vercel.json#crons`. Authenticated via `CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await notifications.publish({
      title: "Daily reminder",
      body: "Don't forget to review your tasks today.",
      data: { source: "cron-daily-digest" },
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
      source: "cron_daily_digest",
    }, {
      route: "/api/notifications/cron/daily-digest",
      level: "error",
    });
    return NextResponse.json({ error: "publish failed" }, { status: 500 });
  }
}
