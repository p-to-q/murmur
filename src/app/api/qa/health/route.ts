import { NextResponse } from "next/server";
import { QA_ROUTE_PATHS } from "@/lib/qa/qa-routes";

export const runtime = "nodejs";

export async function GET() {
  const workerBase = process.env.AUDIO_WORKER_URL?.trim() ?? "";
  const workerConfigured = workerBase.length > 0;
  const workerHealthUrl = workerConfigured
    ? `${workerBase.replace(/\/+$/, "")}/health`
    : null;

  let workerOk = false;
  let workerStatus = "unconfigured";
  let workerService: string | null = null;

  if (workerHealthUrl) {
    try {
      const response = await fetch(workerHealthUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });
      const body = (await response.json()) as {
        status?: unknown;
        service?: unknown;
      };
      workerOk = response.ok && body.status === "ok";
      workerStatus = workerOk ? "ok" : `http_${response.status}`;
      workerService =
        typeof body.service === "string" ? body.service : null;
    } catch (error) {
      workerStatus = error instanceof Error ? error.name : "fetch_failed";
    }
  }

  const ok = workerConfigured ? workerOk : false;

  return NextResponse.json({
    status: ok ? "ok" : "degraded",
    capturedAt: new Date().toISOString(),
    web: {
      status: "ok",
      runtime: process.env.NODE_ENV ?? "development",
    },
    worker: {
      configured: workerConfigured,
      ok: workerOk,
      status: workerStatus,
      service: workerService,
      url: workerHealthUrl,
    },
    qaRoutes: QA_ROUTE_PATHS,
  });
}
