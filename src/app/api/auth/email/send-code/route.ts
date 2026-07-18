import { NextRequest, NextResponse } from "next/server";
import {
  sendVerificationCode,
  isEmailAuthConfigured,
} from "@/lib/auth/email/send-verification";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/auth/email/send-code";
// IP-scoped ceiling on top of the per-email throttle inside
// sendVerificationCode: stops one host from rotating addresses to blast codes.
const SEND_CODE_RATE_LIMIT = { capacity: 5, refillWindowMs: 60_000 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "ip",
    userId: clientIpFromHeaders(request.headers),
    requestId,
    options: SEND_CODE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  if (!isEmailAuthConfigured()) {
    return NextResponse.json(
      { error: "email_auth_disabled", requestId },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_body", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const email = body.email?.trim();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "invalid_email", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const result = await sendVerificationCode(email);

  if (!result.ok) {
    log(
      "auth.email_send_code_failed",
      { error: result.error },
      { route: ROUTE, requestId, level: "warn" },
    );
    const status = result.error === "rate_limit" ? 429 : 500;
    return NextResponse.json(
      { error: result.error, requestId },
      { status, headers: { "X-Request-Id": requestId } },
    );
  }

  log(
    "auth.email_code_sent",
    {},
    { route: ROUTE, requestId },
  );

  return NextResponse.json(
    { ok: true, requestId },
    { headers: { "X-Request-Id": requestId } },
  );
}
