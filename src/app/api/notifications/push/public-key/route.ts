import { NextResponse } from "next/server";

import { getPublicWebPushKey } from "@/lib/platform/notifications-server";

export function GET() {
  return NextResponse.json(getPublicWebPushKey(), {
    headers: { "Cache-Control": "no-store" },
  });
}
