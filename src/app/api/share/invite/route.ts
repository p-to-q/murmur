import { NextResponse, type NextRequest } from "next/server";

import { buildShareInviteUrl } from "@/lib/api/share-links";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json({
    url: buildShareInviteUrl(origin),
  });
}
