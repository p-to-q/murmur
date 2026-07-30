import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { getRequestId } from "@/lib/api/request-id";
import { log } from "@/lib/observability/log";
import { runAccountDeletionCleanup } from "./cleanup";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/account/cron/deletions";

type CleanupRunner = typeof runAccountDeletionCleanup;

export function createAccountDeletionCronHandler(runCleanup: CleanupRunner = runAccountDeletionCleanup) {
  return async function GET(request: NextRequest) {
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
      const summary = await runCleanup({
        limit: parseIntParam(request, "limit", 50),
        concurrency: parseIntParam(request, "concurrency", 5),
      });
      log("account.delete_cleanup_completed", { ...summary }, { route: ROUTE });
      return NextResponse.json(summary, {
        status: summary.failed > 0 || summary.deferred > 0 ? 207 : 200,
        headers: { "X-Request-Id": requestId },
      });
    } catch (error) {
      log("account.delete_cleanup_failed", {
        reason: error instanceof Error ? error.message : String(error),
      }, { route: ROUTE, level: "error" });
      return NextResponse.json(
        { error: "account_deletion_cleanup_failed" },
        { status: 500, headers: { "X-Request-Id": requestId } },
      );
    }
  };
}

export const GET = createAccountDeletionCronHandler();

function timingSafeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function parseIntParam(request: NextRequest, name: string, max: number): number | undefined {
  const raw = new URL(request.url).searchParams.get(name);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return value;
}
