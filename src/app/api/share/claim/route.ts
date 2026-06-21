import { NextResponse, type NextRequest } from "next/server";

import { resolveRequestAuth } from "@/lib/auth";
import {
  canUseShareReferral,
  getSettledShareReferralForInvitee,
  normalizeReferralUserId,
} from "@/lib/db/queries/share-referrals";
import { clearShareReferralCookie, readShareReferrerFromRequest } from "@/lib/api/share-referral-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  const inviteeId = auth.user.id;
  if (!canUseShareReferral(auth.user)) {
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

  const result = await getSettledShareReferralForInvitee({ referrerId, inviteeId });
  if (!result.ok) {
    const response = NextResponse.json(
      { error: result.reason, requestId },
      {
        status: statusForReferralError(result.reason),
        headers: { "X-Request-Id": requestId },
      },
    );
    return clearShareReferralCookie(response);
  }

  const response = NextResponse.json(
    {
      ok: true,
      notesGranted: 0,
      duplicate: true,
      requestId,
    },
    { headers: { "X-Request-Id": requestId } },
  );
  return clearShareReferralCookie(response);
}

async function readReferrerId(request: NextRequest): Promise<string | null> {
  const cookieReferrer = readShareReferrerFromRequest(request);
  if (cookieReferrer) return cookieReferrer;

  try {
    const body = await request.json() as { referrerId?: unknown };
    return typeof body.referrerId === "string" ? body.referrerId : null;
  } catch {
    return null;
  }
}

function statusForReferralError(
  reason: Exclude<Awaited<ReturnType<typeof getSettledShareReferralForInvitee>>, { ok: true }>["reason"],
): number {
  if (reason === "invalid_referrer") return 404;
  if (reason === "grant_failed") return 500;
  if (reason === "registration_required" || reason === "ineligible_invitee") return 409;
  return 400;
}
