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

export const runtime = "nodejs";

const ROUTE = "/api/auth/email/verify-code";

export async function POST(request: NextRequest) {
  if (!isEmailAuthConfigured()) {
    return NextResponse.json(
      { error: "email_auth_disabled" },
      { status: 404 },
    );
  }

  let body: { email?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = body.email?.trim();
  const code = body.code?.trim();
  if (!email || !code) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const verification = await verifyCode(email, code);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error },
      { status: verification.error === "max_attempts" ? 429 : 400 },
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

    const response = NextResponse.json({
      ok: true,
      user: { id: userId, email: normalized, accountKind: "registered" },
    });
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
      { route: ROUTE, level: "error" },
    );
    return NextResponse.json(
      { error: "verification_failed" },
      { status: 500 },
    );
  }
}
