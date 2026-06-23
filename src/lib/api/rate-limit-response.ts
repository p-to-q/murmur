import { NextResponse } from "next/server";

type RateLimitResponseResult = {
  retryAfterMs: number;
  limit: number;
  remaining: number;
  retryAt: Date;
};

export function rateLimitedResponse(
  result: RateLimitResponseResult,
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
  result: RateLimitResponseResult,
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
