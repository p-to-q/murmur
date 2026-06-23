import { NextResponse } from "next/server";

import { log } from "@/lib/observability/log";
import {
  getRateLimitStore,
  type RateLimitOptions,
  type RateLimitResult,
} from "@/lib/rate-limit";

export interface ApiRateLimitInput {
  route: string;
  bucket: string;
  userId: string;
  requestId?: string;
  sessionId?: string | null;
  options: RateLimitOptions;
}

export async function checkApiRateLimit(
  input: ApiRateLimitInput,
): Promise<RateLimitResult> {
  const result = await getRateLimitStore().hit(apiRateLimitKey(input), input.options);

  if (!result.allowed) {
    log("rate_limit.tripped", {
      bucket: input.bucket,
      retryAfterMs: result.retryAfterMs,
      limit: result.limit,
      remaining: result.remaining,
    }, {
      route: input.route,
      requestId: input.requestId,
      userId: input.userId,
      sessionId: input.sessionId,
      level: "warn",
    });
  }

  return result;
}

export async function refundApiRateLimit(input: ApiRateLimitInput): Promise<void> {
  await getRateLimitStore().refund(apiRateLimitKey(input), input.options);
}

export function rateLimitedResponse(
  result: RateLimitResult,
  requestId?: string,
): NextResponse {
  return NextResponse.json(
    {
      error: "rate_limited",
      message: "Too many requests. Please try again shortly.",
      requestId,
    },
    {
      status: 429,
      headers: rateLimitHeaders(result, requestId),
    },
  );
}

export function rateLimitHeaders(
  result: RateLimitResult,
  requestId?: string,
): HeadersInit {
  const headers: Record<string, string> = {
    "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.retryAt.getTime() / 1000)),
  };
  if (requestId) headers["X-Request-Id"] = requestId;
  return headers;
}

export function apiRateLimitKey(input: ApiRateLimitInput): string {
  return `${input.route}:${input.bucket}:${input.userId}`;
}
