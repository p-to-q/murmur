/**
 * GET /api/billing/cron/refunds — provider-neutral pending spend-refund
 * reconciler (#299).
 *
 * Recovers durable `refund:pending` markers (#232) directly from the ledger,
 * with NO Waffo credentials or client required — a product spend refund is a
 * pure ledger operation. Protected by CRON_SECRET, idempotent on original
 * ledger ids, and safe to run repeatedly. Scheduled by `vercel.json#crons`.
 */
import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { reconcilePendingRefunds } from "@/lib/billing/pending-refund-reconcile";
import { getRequestId } from "@/lib/api/request-id";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const ROUTE = "/api/billing/cron/refunds";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }

  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!timingSafeTokenEqual(token, expected)) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "X-Request-Id": requestId } },
    );
  }

  try {
    const pageLimit = parseIntParam(request, "pageLimit");
    const maxPages = parseIntParam(request, "maxPages");
    const summary = await reconcilePendingRefunds({ pageLimit, maxPages });

    // 207 signals unfinished work (a refund that still needs a human) after the
    // pass; 200 means everything owed was applied or already settled.
    const status = summary.requiresManualReview > 0 ? 207 : 200;

    log(
      "billing.pending_refunds_reconciled",
      { ...summary },
      { route: ROUTE, level: summary.requiresManualReview > 0 ? "warn" : "info" },
    );

    return NextResponse.json(summary, { status, headers: { "X-Request-Id": requestId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      "billing.pending_refunds_failed",
      { error: message },
      { route: ROUTE, level: "error" },
    );
    return NextResponse.json(
      { error: "reconcile_failed", message },
      { status: 500, headers: { "X-Request-Id": requestId } },
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

function parseIntParam(request: NextRequest, name: string): number | undefined {
  const raw = new URL(request.url).searchParams.get(name);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error(`${name} must be an integer between 1 and 500`);
  }
  return value;
}
