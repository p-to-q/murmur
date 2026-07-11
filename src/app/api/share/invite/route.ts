import { NextResponse, type NextRequest } from "next/server";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { buildShareInviteUrl } from "@/lib/api/share-links";
import { canUseShareReferral } from "@/lib/db/queries/share-referrals";
import { getSiteUrlForRequest } from "@/lib/site-url";

export const runtime = "nodejs";

const ROUTE = "/api/share/invite";
const RATE_LIMIT = { capacity: 60, refillWindowMs: 60_000 };

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "read:user",
    userId: auth.ok ? auth.user.id : clientIpFromHeaders(request.headers),
    requestId,
    sessionId: auth.ok ? auth.sessionId : null,
    options: RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  const origin = getSiteUrlForRequest(request);
  const inviterId = auth.ok && canUseShareReferral(auth.user) ? auth.user.id : null;
  return NextResponse.json(
    { url: buildShareInviteUrl(origin, inviterId) },
    { headers: { "X-Request-Id": requestId } },
  );
}
