import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { LOCAL_CREATOR_FREE_NOTES } from "@murmur/core";
import {
  checkApiRateLimit,
  rateLimitedResponse,
  refundApiRateLimit,
  type ApiRateLimitInput,
} from "@/lib/api/rate-limit";
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
const LOCAL_CREATOR_FINGERPRINT_LIMIT = {
  capacity: 1,
  refillWindowMs: 24 * 60 * 60 * 1000,
};
const LOCAL_CREATOR_IP_LIMIT = {
  capacity: 10,
  refillWindowMs: 24 * 60 * 60 * 1000,
};

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(request, { allowGuestPreview: true });
  if (auth.ok && auth.source !== "guest" && auth.user.id !== "guest") {
    return NextResponse.json({
      user: auth.user,
      source: auth.source,
      sessionId: auth.sessionId,
      created: false,
    });
  }

  const ip = clientIpFromHeaders(request.headers);
  const consumedLimits: ApiRateLimitInput[] = [];
  const fingerprintLimitInput = {
    route: ROUTE,
    bucket: "fingerprint:daily",
    userId: localCreatorFingerprint(request, ip),
    requestId,
    sessionId: null,
    options: LOCAL_CREATOR_FINGERPRINT_LIMIT,
  };
  const fingerprintLimit = await checkApiRateLimit(fingerprintLimitInput);
  if (!fingerprintLimit.allowed) {
    return rateLimitedResponse(fingerprintLimit, requestId);
  }
  consumedLimits.push(fingerprintLimitInput);

  const ipLimitInput = {
    route: ROUTE,
    bucket: "ip:daily",
    userId: ip,
    requestId,
    sessionId: null,
    options: LOCAL_CREATOR_IP_LIMIT,
  };
  const ipLimit = await checkApiRateLimit(ipLimitInput);
  if (!ipLimit.allowed) {
    await refundConsumedLimits(consumedLimits);
    return rateLimitedResponse(ipLimit, requestId);
  }
  consumedLimits.push(ipLimitInput);

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
    });
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
      { status: 503 },
    );
  }
}

async function refundConsumedLimits(inputs: ApiRateLimitInput[]): Promise<void> {
  await Promise.all(inputs.map((input) => refundApiRateLimit(input)));
}

function localCreatorFingerprint(request: NextRequest, ip: string): string {
  const userAgent = request.headers.get("user-agent")?.trim().slice(0, 512) || "unknown";
  const uaHash = createHash("sha256").update(userAgent, "utf8").digest("hex").slice(0, 16);
  return `${ip}:ua:${uaHash}`;
}
