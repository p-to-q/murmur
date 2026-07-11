import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { reconcileWaffoBilling } from "@/lib/billing/waffo-reconcile";
import { log } from "@/lib/observability/log";
import { resolveWaffoPrivateKey } from "@/lib/platform/waffo-server";

export const runtime = "nodejs";

const ROUTE = "/api/billing/cron/reconcile";

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!timingSafeTokenEqual(token, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const merchantId = process.env.WAFFO_MERCHANT_ID?.trim();
  const privateKey = resolveWaffoPrivateKey();
  if (!merchantId || !privateKey) {
    return NextResponse.json(
      { error: "waffo_not_configured" },
      { status: 503 },
    );
  }

  try {
    const limit = parseLimit(request);
    const autoFix = resolveAutoFix(request);
    const report = await reconcileWaffoBilling({ merchantId, privateKey, limit, autoFix });

    // When auto-fix ran, 207 means something still needs a human AFTER repair;
    // otherwise it reflects the raw detection count (report-only behaviour).
    const unresolved = report.autoFix
      ? report.autoFix.requiresManualReview
      : report.summary.errorCount;
    const status = unresolved > 0 ? 207 : 200;

    if (report.autoFix) {
      log(
        "billing.reconcile_autofixed",
        { ...report.summary, ...report.autoFix },
        {
          route: ROUTE,
          level: report.autoFix.requiresManualReview > 0 ? "warn" : "info",
        },
      );
    } else if (report.summary.errorCount > 0) {
      log(
        "billing.reconcile_mismatch",
        { ...report.summary },
        { route: ROUTE, level: "warn" },
      );
    } else {
      log(
        "billing.reconcile_ok",
        { ...report.summary },
        { route: ROUTE },
      );
    }

    return NextResponse.json(report, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      "billing.reconcile_failed",
      { error: message },
      { route: ROUTE, level: "error" },
    );
    return NextResponse.json(
      { error: "reconcile_failed", message },
      { status: 500 },
    );
  }
}

function timingSafeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against itself to burn constant time, then return false.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Auto-fix is gated so drift repair is deliberate (#238): enabled by
 * `WAFFO_RECONCILE_AUTOFIX=1` for the scheduled cron, and overridable per
 * request with `?autoFix=1|0` for a manual run. Defaults off (report-only).
 */
function resolveAutoFix(request: NextRequest): boolean {
  const param = new URL(request.url).searchParams.get("autoFix");
  if (param === "1" || param === "true") return true;
  if (param === "0" || param === "false") return false;
  return process.env.WAFFO_RECONCILE_AUTOFIX === "1";
}

function parseLimit(request: NextRequest): number | undefined {
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error("limit must be an integer between 1 and 500");
  }
  return value;
}
