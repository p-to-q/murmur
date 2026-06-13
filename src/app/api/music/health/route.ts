import { NextResponse } from "next/server";
import { getMusicWorkerUrl, isMusicWorkerConfigured } from "@/lib/platform/music-worker";

export const runtime = "nodejs";

/**
 * GET /api/music/health — can the Magenta worker take generation requests?
 *
 * `available: true` also while the model is still warming up: requests queue
 * behind the load instead of failing, so the client may commit to the
 * Magenta path as soon as the worker process answers.
 */
export async function GET() {
  const configured = isMusicWorkerConfigured();
  const workerBase = getMusicWorkerUrl();
  if (!workerBase) {
    return NextResponse.json({
      available: false,
      configured: false,
      reason: "unconfigured",
    });
  }

  try {
    // Tunnel round-trips from a cold Vercel function can take several
    // seconds — the first probe after a tunnel reconnect routinely blows
    // an 8s budget. Clients budget 20s and retry once, so 12s here keeps
    // a real answer ahead of their deadline.
    const res = await fetch(`${workerBase.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        available: false,
        configured,
        reason: `http_${res.status}`,
      });
    }
    const data = (await res.json()) as {
      status?: string;
      model?: string;
      mock?: boolean;
      loaded?: boolean;
      loading?: boolean;
      loadError?: string | null;
    };
    // A worker that is loading (or already has a model resident) can take
    // generation requests — they queue behind the load. Only a hard load
    // failure with no model counts as unavailable; a transient `degraded`
    // blip must not pin clients to the legacy engine.
    const available =
      data.status === "ok" || data.loaded === true || data.loading === true;
    return NextResponse.json({
      available,
      configured,
      model: data.model ?? null,
      mock: data.mock ?? false,
      loaded: data.loaded ?? false,
      loading: data.loading ?? false,
      reason: available ? null : data.loadError ?? "degraded",
    });
  } catch {
    return NextResponse.json({
      available: false,
      configured,
      reason: "unreachable",
    });
  }
}
