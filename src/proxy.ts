import { NextResponse, type NextRequest } from "next/server";
import { ulid } from "ulid";

import { rateLimitedResponse } from "@/lib/api/rate-limit";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";
import { getRateLimitStore } from "@/lib/rate-limit";

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
 * The store is process-local (memory driver), so on multi-instance deploys
 * each instance enforces its own bucket. That's acceptable for a backstop;
 * a shared driver can be swapped in via MURMUR_RATE_LIMIT_DRIVER later.
 */

const GLOBAL_API_RATE_LIMIT = { capacity: 100, refillWindowMs: 60_000 };

function clientIp(request: NextRequest): string {
  return clientIpFromHeaders(request.headers);
}

export default async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || ulid();

  const result = await getRateLimitStore().hit(
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
