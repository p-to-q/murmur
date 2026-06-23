import { NextResponse, type NextRequest } from "next/server";
import { ulid } from "ulid";

import { rateLimitedResponse } from "@/lib/api/rate-limit-response";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { validateCookieAuthenticatedSameOrigin } from "@/lib/http/origin-guard";
import { log } from "@/lib/observability/log";
import { createMemoryRateLimitStore } from "@/lib/rate-limit/adapters/memory";

/**
 * Edge-of-app proxy (Next 16's successor to middleware.ts).
 *
 * Two jobs, both cheap:
 *  1. Stamp every API request with a ULID `x-request-id` (visible to route
 *     handlers via request headers and echoed on the response) so logs from
 *     one request chain correlate.
 *  2. Coarse per-IP token bucket over all /api routes — a backstop against
 *     runaway clients and scripted abuse. Per-user limits on expensive
 *     routes (song create, transcribe) still apply downstream.
 *
 * The proxy deliberately keeps its coarse edge backstop in memory. Route-level
 * expensive-operation limits use the shared default rate-limit store.
 */

const GLOBAL_API_RATE_LIMIT = { capacity: 100, refillWindowMs: 60_000 };
const globalApiRateLimitStore = createMemoryRateLimitStore();

function clientIp(request: NextRequest): string {
  return clientIpFromHeaders(request.headers);
}

export default async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || ulid();

  const originGuard = validateCookieAuthenticatedSameOrigin(request);
  if (!originGuard.allowed) {
    log("security.cross_origin_unsafe_request_blocked", {
      reason: originGuard.reason,
      requestOrigin: originGuard.requestOrigin,
      targetOrigin: originGuard.targetOrigin,
    }, {
      route: request.nextUrl.pathname,
      requestId,
      level: "warn",
    });
    return NextResponse.json(
      {
        error: "cross_origin_request",
        message: "Unsafe cookie-authenticated API requests must come from this site.",
        requestId,
      },
      { status: 403, headers: { "X-Request-Id": requestId } },
    );
  }

  const result = await globalApiRateLimitStore.hit(
    `global:ip:${clientIp(request)}`,
    GLOBAL_API_RATE_LIMIT,
  );

  if (!result.allowed) {
    log("rate_limit.tripped", {
      bucket: "global:ip",
      retryAfterMs: result.retryAfterMs,
      limit: result.limit,
      remaining: result.remaining,
    }, {
      route: request.nextUrl.pathname,
      requestId,
      level: "warn",
    });
    return rateLimitedResponse(result, requestId);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
