import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { LOCAL_CREATOR_FREE_NOTES } from "@murmur/core";
import {
  checkApiRateLimit,
  rateLimitedResponse,
  refundApiRateLimit,
  type ApiRateLimitInput,
} from "@/lib/api/rate-limit";
import {
  localCreatorFingerprintLimitInput,
  localCreatorIpLimitInput,
} from "@/lib/api/local-creator-rate-limit";
import {
  SESSION_COOKIE_NAME,
  murmurSessionCookieOptions,
  resolveRequestAuth,
} from "@/lib/platform/server-auth";
import { createSession } from "@/lib/db/queries/sessions";
import { createLocalCreatorUser } from "@/lib/db/queries/users";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/auth/local-creator";

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || randomUUID();
  const auth = await resolveRequestAuth(request, { allowGuestPreview: true });
  if (auth.ok && auth.source !== "guest" && auth.user.id !== "guest") {
    return NextResponse.json(
      { user: auth.user, source: auth.source, sessionId: auth.sessionId, created: false },
      { headers: { "X-Request-Id": requestId } },
    );
  }

  const ip = clientIpFromHeaders(request.headers);
  const consumedLimits: ApiRateLimitInput[] = [];
  const fingerprintLimitInput = localCreatorFingerprintLimitInput({
    headers: request.headers,
    ip,
    requestId,
  });
  const fingerprintLimit = await checkApiRateLimit(fingerprintLimitInput);
  if (!fingerprintLimit.allowed) {
    return rateLimitedResponse(fingerprintLimit, requestId);
  }
  consumedLimits.push(fingerprintLimitInput);

  const ipLimitInput = localCreatorIpLimitInput({ ip, requestId });
  if (ipLimitInput) {
    const ipLimit = await checkApiRateLimit(ipLimitInput);
    if (!ipLimit.allowed) {
      await refundConsumedLimits(consumedLimits);
      return rateLimitedResponse(ipLimit, requestId);
    }
    consumedLimits.push(ipLimitInput);
  }

  try {
    const user = await createLocalCreatorUser();
    const session = await createSession({
      userId: user.id,
      shell: "web",
      metadata: {
        userAgent: request.headers.get("user-agent") ?? undefined,
        ip,
      },
    });

    log(
      "auth.local_creator_created",
      { notes: LOCAL_CREATOR_FREE_NOTES },
      { route: ROUTE, userId: user.id, sessionId: session.sessionId },
    );

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: session.sessionId,
      created: true,
    }, { headers: { "X-Request-Id": requestId } });
    response.cookies.set(
      SESSION_COOKIE_NAME,
      session.token,
      murmurSessionCookieOptions(session.expiresAt),
    );
    return response;
  } catch (error) {
    await refundConsumedLimits(consumedLimits);
    log(
      "auth.local_creator_failed",
      { error: error instanceof Error ? error.message : String(error) },
      { route: ROUTE, level: "error" },
    );
    return NextResponse.json(
      {
        error: "local_creator_unavailable",
        message: "Could not create a Local Creator account.",
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }
}

async function refundConsumedLimits(inputs: ApiRateLimitInput[]): Promise<void> {
  const results = await Promise.allSettled(
    inputs.map((input) => refundApiRateLimit(input)),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    log(
      "auth.local_creator_failed",
      {
        phase: "rate_limit_refund",
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      },
      {
        route: ROUTE,
        requestId: inputs[index]?.requestId,
        level: "warn",
      },
    );
  }
}
