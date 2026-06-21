import type { NextRequest, NextResponse } from "next/server";

import { SHARE_REFERRAL_COOKIE } from "@/lib/api/share-referral-constants";
import { normalizeReferralUserId } from "@/lib/db/queries/share-referrals";

export function readShareReferrerFromCookieHeader(cookieHeader: string | null): string | null {
  return normalizeReferralUserId(
    parseCookieHeader(cookieHeader, SHARE_REFERRAL_COOKIE),
  );
}

export function readShareReferrerFromRequest(request: NextRequest): string | null {
  const raw =
    request.cookies?.get(SHARE_REFERRAL_COOKIE)?.value ??
    parseCookieHeader(request.headers.get("cookie"), SHARE_REFERRAL_COOKIE);
  return normalizeReferralUserId(raw);
}

export function clearShareReferralCookie(response: NextResponse): NextResponse {
  response.cookies.set(SHARE_REFERRAL_COOKIE, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax",
  });
  return response;
}

function parseCookieHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}
