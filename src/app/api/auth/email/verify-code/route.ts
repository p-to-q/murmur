import { NextRequest, NextResponse } from "next/server";
import {
  verifyCode,
  isEmailAuthConfigured,
} from "@/lib/auth/email/send-verification";
import { upsertOAuthUser, normalizeEmail } from "@/lib/db/queries/users";
import { createSession } from "@/lib/db/queries/sessions";
import {
  SESSION_COOKIE_NAME,
  murmurSessionCookieOptions,
  resolveRequestAuth,
} from "@/lib/platform/server-auth";
import { log } from "@/lib/observability/log";
import {
  clearShareReferralCookie,
  readShareReferrerFromRequest,
} from "@/lib/api/share-referral-server";
import { settleRegistrationShareReferral } from "@/lib/auth/share-referral-settlement";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { clientIpFromHeaders } from "@/lib/http/client-ip";

export const runtime = "nodejs";

const ROUTE = "/api/auth/email/verify-code";
// IP-scoped ceiling on top of verifyCode's per-email attempt cap: stops one
// host from brute-forcing codes across many addresses.
const VERIFY_CODE_RATE_LIMIT = { capacity: 10, refillWindowMs: 60_000 };

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "ip",
    userId: clientIpFromHeaders(request.headers),
    requestId,
    options: VERIFY_CODE_RATE_LIMIT,
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

  let body: { email?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_body", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const email = body.email?.trim();
  const code = body.code?.trim();
  if (!email || !code) {
    return NextResponse.json(
      { error: "missing_fields", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const verification = await verifyCode(email, code);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error, requestId },
      {
        status: verification.error === "max_attempts" ? 429 : 400,
        headers: { "X-Request-Id": requestId },
      },
    );
  }

  try {
    // Resolve local creator for promotion
    const auth = await resolveRequestAuth(request, { allowGuestPreview: true });
    const localCreatorUserId =
      auth.ok && auth.user.accountKind === "local_creator"
        ? auth.user.id
        : null;

    const normalized = normalizeEmail(email);
    const { userId, created, registrationKind } = await upsertOAuthUser({
      provider: "email",
      externalId: normalized,
      email: normalized,
      name: normalized.split("@")[0],
      image: null,
      localCreatorUserId,
    });

    const session = await createSession({
      userId,
      shell: "web",
      metadata: {
        userAgent: request.headers.get("user-agent") ?? undefined,
        ip:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request.headers.get("x-real-ip")?.trim() ||
          undefined,
      },
    });

    if (created) {
      log(
        "auth.user_provisioned",
        { provider: "email" },
        { route: ROUTE, userId, sessionId: session.sessionId, shell: "web" },
      );
    }

    const referrerId = readShareReferrerFromRequest(request);
    await settleRegistrationShareReferral({
      referrerId,
      inviteeId: userId,
      registrationKind,
      source: "email",
      route: ROUTE,
      sessionId: session.sessionId,
      metadata: {
        provider: "email",
      },
    });

    const response = NextResponse.json(
      {
        ok: true,
        user: { id: userId, email: normalized, accountKind: "registered" },
        requestId,
      },
      { headers: { "X-Request-Id": requestId } },
    );
    response.cookies.set(
      SESSION_COOKIE_NAME,
      session.token,
      murmurSessionCookieOptions(session.expiresAt),
    );
    return referrerId ? clearShareReferralCookie(response) : response;
  } catch (error) {
    log(
      "auth.email_verify_failed",
      { error: error instanceof Error ? error.message : String(error) },
      { route: ROUTE, requestId, level: "error" },
    );
    return NextResponse.json(
      { error: "verification_failed", requestId },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}
