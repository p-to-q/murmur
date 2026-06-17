import { NextResponse, type NextRequest } from "next/server";

import { resolveRequestAuth } from "@/lib/auth";
import { buildShareInviteUrl } from "@/lib/api/share-links";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await resolveRequestAuth(request);
  const origin = getRequestOrigin(request);
  const inviterId = auth.ok && auth.user.id !== "guest" ? auth.user.id : null;
  return NextResponse.json({
    url: buildShareInviteUrl(origin, inviterId),
  });
}

function getRequestOrigin(request: NextRequest): string {
  if (request.nextUrl?.origin) return request.nextUrl.origin;
  return new URL(request.url).origin;
}
