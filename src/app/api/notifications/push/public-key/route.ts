import { NextRequest, NextResponse } from "next/server";

import { getRequestId } from "@/lib/api/request-id";
import { getPublicWebPushKey } from "@/lib/platform/notifications-server";

export function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  return NextResponse.json(
    { ...getPublicWebPushKey(), requestId },
    { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}
