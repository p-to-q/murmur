import { NextResponse, type NextRequest } from "next/server";

import { resolveRequestAuth } from "@/lib/auth";
import {
  claimShareReferral,
  normalizeReferralUserId,
  SHARE_REFERRAL_REWARD_NOTES,
} from "@/lib/db/queries/share-referrals";
import { SHARE_REFERRAL_COOKIE } from "@/lib/api/share-referral-constants";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/share/claim";

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  const inviteeId = auth.user.id;
  if (inviteeId === "guest") {
    return NextResponse.json(
      { error: "sign_in_required", requestId },
      { status: 403, headers: { "X-Request-Id": requestId } },
    );
  }

  const referrerId = normalizeReferralUserId(
    await readReferrerId(request),
  );
  if (!referrerId) {
    return NextResponse.json(
      { error: "missing_referrer", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const result = await claimShareReferral({ referrerId, inviteeId });
  if (!result.ok) {
    const status = result.reason === "invalid_referrer" ? 404 : 400;
    return NextResponse.json(
      { error: result.reason, requestId },
      { status, headers: { "X-Request-Id": requestId } },
    );
  }

  log("notes.granted", {
    reason: "grant:referral",
    amount: SHARE_REFERRAL_REWARD_NOTES,
    referrerId,
    inviteeId,
    duplicate: result.duplicate,
  }, {
    route: ROUTE,
    requestId,
    userId: inviteeId,
    sessionId: auth.sessionId,
  });

  const response = NextResponse.json(
    {
      ok: true,
      notesGranted: SHARE_REFERRAL_REWARD_NOTES,
      duplicate: result.duplicate,
      requestId,
    },
    { headers: { "X-Request-Id": requestId } },
  );
  response.cookies.set(SHARE_REFERRAL_COOKIE, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax",
  });
  return response;
}

async function readReferrerId(request: NextRequest): Promise<string | null> {
  const cookieReferrer =
    request.cookies?.get(SHARE_REFERRAL_COOKIE)?.value ??
    parseCookieHeader(request.headers.get("cookie"), SHARE_REFERRAL_COOKIE);
  if (cookieReferrer) return cookieReferrer;

  try {
    const body = await request.json() as { referrerId?: unknown };
    return typeof body.referrerId === "string" ? body.referrerId : null;
  } catch {
    return null;
  }
}

function parseCookieHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}
