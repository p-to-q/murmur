import { NextResponse } from "next/server";
import { getMusicWorkerUrl } from "@/lib/platform/music-worker";

export const runtime = "nodejs";

/**
 * GET /api/music/health — can the Magenta worker take generation requests?
 *
 * `available: true` also while the model is still warming up: requests queue
 * behind the load instead of failing, so the client may commit to the
 * Magenta path as soon as the worker process answers.
 */
export async function GET() {
  const workerBase = getMusicWorkerUrl();
  if (!workerBase) {
    return NextResponse.json({ available: false, reason: "unconfigured" });
  }

  try {
    // Tunnel round-trips from a cold Vercel function can take a few
    // seconds; clients budget 10s for the whole probe, so 8s here keeps
    // a real answer ahead of their deadline.
    const res = await fetch(`${workerBase.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ available: false, reason: `http_${res.status}` });
    }
    const data = (await res.json()) as {
      status?: string;
      model?: string;
      mock?: boolean;
      loaded?: boolean;
      loading?: boolean;
      loadError?: string | null;
    };
    const available = data.status === "ok";
    return NextResponse.json({
      available,
      model: data.model ?? null,
      mock: data.mock ?? false,
      loaded: data.loaded ?? false,
      loading: data.loading ?? false,
      reason: available ? null : data.loadError ?? "degraded",
    });
  } catch {
    return NextResponse.json({ available: false, reason: "unreachable" });
  }
}
