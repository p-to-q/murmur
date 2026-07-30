import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { getRequestId } from "@/lib/api/request-id";
import { log } from "@/lib/observability/log";
import { runSongAudioCleanup } from "./cleanup";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/storage/cron/song-audio";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const expected = process.env.CRON_SECRET;
  if (!expected) return response({ error: "CRON_SECRET is not configured" }, 500, requestId);

  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!timingSafeTokenEqual(token, expected)) {
    return response({ error: "unauthorized" }, 401, requestId);
  }

  try {
    const summary = await runSongAudioCleanup({
      limit: parseIntParam(request, "limit", 100),
      concurrency: parseIntParam(request, "concurrency", 10),
    });
    log("song.audio_cleanup_completed", { ...summary }, { route: ROUTE });
    return response(summary, summary.failed > 0 ? 207 : 200, requestId);
  } catch (error) {
    log("song.audio_cleanup_failed", {
      reason: error instanceof Error ? error.message : String(error),
    }, { route: ROUTE, level: "error" });
    return response({ error: "song_audio_cleanup_failed" }, 500, requestId);
  }
}

function response(body: object, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}

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
