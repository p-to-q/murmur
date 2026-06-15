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
  if (auth !== `Bearer ${expected}`) {
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
    const report = await reconcileWaffoBilling({ merchantId, privateKey, limit });
    const status = report.summary.errorCount > 0 ? 207 : 200;

    if (report.summary.errorCount > 0) {
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

function parseLimit(request: NextRequest): number | undefined {
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error("limit must be an integer between 1 and 500");
  }
  return value;
}
