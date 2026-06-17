import { NextResponse, type NextRequest } from "next/server";

import { resolveRequestAuth } from "@/lib/auth";
import { buildShareInviteUrl } from "@/lib/api/share-links";
import { canUseShareReferral } from "@/lib/db/queries/share-referrals";
import { getSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  const origin = getSiteUrl();
  const inviterId = auth.ok && canUseShareReferral(auth.user) ? auth.user.id : null;
  return NextResponse.json({
    url: buildShareInviteUrl(origin, inviterId),
  });
}
