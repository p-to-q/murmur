import { log } from "@/lib/observability/log";
import {
  getRateLimitStore,
  type RateLimitOptions,
  type RateLimitResult,
} from "@/lib/rate-limit";

export { rateLimitedResponse, rateLimitHeaders } from "./rate-limit-response";

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

export function apiRateLimitKey(input: ApiRateLimitInput): string {
  return `${input.route}:${input.bucket}:${input.userId}`;
}
