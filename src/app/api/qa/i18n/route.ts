import { NextRequest, NextResponse } from "next/server";
import { resolveRequestAuth } from "@/lib/auth";
import { auditI18nUsage, type I18nAuditResult } from "@/lib/i18n/audit";
import { requireDebugSurfaceAccess } from "@/lib/observability/debug-surface";

export const runtime = "nodejs";

const CACHE_TTL_MS = 30_000;
let cachedAudit: { expiresAt: number; result: I18nAuditResult } | null = null;

export async function GET(request: NextRequest) {
  const gate = await requireDebugSurfaceAccess(request, resolveRequestAuth);
  if (gate) return gate;

  const now = Date.now();
  if (cachedAudit && cachedAudit.expiresAt > now) {
    return NextResponse.json({
      ...cachedAudit.result,
      cached: true,
    });
  }

  const result = auditI18nUsage();
  cachedAudit = {
    result,
    expiresAt: now + CACHE_TTL_MS,
  };

  return NextResponse.json({
    ...result,
    cached: false,
  });
}
