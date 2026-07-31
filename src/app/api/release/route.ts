import { NextResponse } from "next/server";
import { getReleaseIdentity } from "@/lib/app-version";
import { releaseResourceFingerprint } from "@/lib/platform/release-resource-fingerprint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public, non-secret deployment identity used by release and support checks. */
export async function GET() {
  return NextResponse.json({
    ...getReleaseIdentity(),
    resourceFingerprint: releaseResourceFingerprint(),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
