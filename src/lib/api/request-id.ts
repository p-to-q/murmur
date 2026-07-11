import { type NextRequest } from "next/server";

/**
 * Resolve the request id for a route invocation.
 *
 * Echoes the client-supplied `X-Request-Id` header when present (so shells
 * can correlate traces end to end), otherwise mints a UUID. Per
 * docs/api-conventions.md §12, every response should carry this value back
 * in an `X-Request-Id` header — `errorResponse()` and
 * `rateLimitedResponse()` do that automatically; success paths set it on
 * `NextResponse.json(..., { headers })` explicitly.
 */
export function getRequestId(request: NextRequest): string {
  return request.headers.get("x-request-id") || crypto.randomUUID();
}
