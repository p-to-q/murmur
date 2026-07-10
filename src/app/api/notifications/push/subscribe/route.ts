import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import {
  notifications,
  safeEndpointHost,
} from "@/lib/platform/notifications-server";
import { log } from "@/lib/observability/log";

// Browser push services only hand out HTTPS endpoints; anything else would
// point our web-push sender at an arbitrary (possibly internal) target.
const httpsEndpoint = z.url({
  protocol: /^https$/,
  error: "Push endpoint must use HTTPS",
});

const subscriptionSchema = z.object({
  endpoint: httpsEndpoint,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

const subscribeSchema = z.object({
  subscription: subscriptionSchema,
  locale: z.string().min(2).max(16).nullable().optional(),
  timezone: z.string().min(1).max(80).nullable().optional(),
});

const unsubscribeSchema = z.object({
  endpoint: httpsEndpoint,
});

const ROUTE = "/api/notifications/push/subscribe";
const MUTATE_RATE_LIMIT = { capacity: 20, refillWindowMs: 60_000 };

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "create:user",
    userId: auth.user.id,
    requestId,
    sessionId: auth.sessionId,
    options: MUTATE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  let body: z.infer<typeof subscribeSchema>;
  try {
    body = subscribeSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: "validation_error",
        message: "Invalid push subscription payload",
        issues: error instanceof z.ZodError ? error.issues : undefined,
      },
      { status: 400 },
    );
  }

  try {
    const row = await notifications.subscribeDevice({
      userId: auth.user.id,
      sessionId: auth.sessionId,
      subscription: body.subscription,
      userAgent: request.headers.get("user-agent"),
      locale: body.locale,
      timezone: body.timezone,
    });

    return NextResponse.json({
      ok: true,
      subscriptionId: row.id,
      endpointHost: safeEndpointHost(row.endpoint),
    });
  } catch (error) {
    log("notifications.subscribe_failed", {
      phase: "subscribe",
      error: error instanceof Error ? error.message : String(error),
    }, {
      route: "/api/notifications/push/subscribe",
      userId: auth.user.id,
      sessionId: auth.sessionId,
      level: "error",
    });
    return NextResponse.json(
      { error: "push_subscribe_failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof unsubscribeSchema>;
  try {
    body = unsubscribeSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: "validation_error",
        message: "Invalid push unsubscribe payload",
        issues: error instanceof z.ZodError ? error.issues : undefined,
      },
      { status: 400 },
    );
  }

  try {
    await notifications.unsubscribeDevice({
      endpoint: body.endpoint,
      userId: auth.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log("notifications.unsubscribe_failed", {
      phase: "unsubscribe",
      endpointHost: safeEndpointHost(body.endpoint),
      error: error instanceof Error ? error.message : String(error),
    }, {
      route: "/api/notifications/push/subscribe",
      userId: auth.user.id,
      sessionId: auth.sessionId,
      level: "error",
    });
    return NextResponse.json(
      { error: "push_unsubscribe_failed" },
      { status: 500 },
    );
  }
}
