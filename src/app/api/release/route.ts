import { NextResponse } from "next/server";
import { getReleaseIdentity } from "@/lib/app-version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public, non-secret deployment identity used by release and support checks. */
export async function GET() {
  return NextResponse.json(getReleaseIdentity(), {
    headers: { "Cache-Control": "no-store" },
  });
}
