import { NextResponse } from "next/server";
import {
  getMusicEngineMode,
  getMusicServerlessConfig,
  getMusicWorkerUrl,
  isMusicWorkerConfigured,
} from "@/lib/platform/music-worker";
import { endpointHealth } from "@/lib/platform/runpod-serverless";

export const runtime = "nodejs";

/**
 * GET /api/music/health — can the Magenta engine take generation requests?
 *
 * Serverless (prod): "reachable" means available — a scale-to-zero endpoint
 * normally reports 0 idle/running workers but still accepts jobs that cold-start
 * on demand, so we only report unavailable when the endpoint itself is
 * unreachable or rejects our key.
 *
 * HTTP (dev/legacy): available also while the model is still warming up;
 * requests queue behind the load instead of failing.
 */
export async function GET() {
  const mode = getMusicEngineMode();
  if (!mode) {
    return NextResponse.json({
      available: false,
      configured: false,
      reason: "unconfigured",
    });
  }

  return mode === "serverless" ? serverlessHealth() : httpHealth();
}

async function serverlessHealth() {
  const config = getMusicServerlessConfig();
  if (!config) {
    return NextResponse.json({ available: false, configured: false, reason: "unconfigured" });
  }

  try {
    const { ok, status, body } = await endpointHealth(config, AbortSignal.timeout(12_000));
    if (!ok) {
      const unauthorized = status === 401 || status === 403;
      return NextResponse.json({
        available: false,
        configured: true,
        mode: "serverless",
        reason: unauthorized ? "unauthorized" : `http_${status}`,
      });
    }
    const workers = (body as { workers?: Record<string, number> } | null)?.workers ?? null;
    return NextResponse.json({
      available: true,
      configured: true,
      mode: "serverless",
      workers,
      reason: null,
    });
  } catch {
    return NextResponse.json({
      available: false,
      configured: true,
      mode: "serverless",
      reason: "unreachable",
    });
  }
}

async function httpHealth() {
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
    // Tunnel round-trips from a cold Vercel function can take several seconds;
    // clients budget 20s and retry once, so 12s here keeps a real answer ahead
    // of their deadline.
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
      mode: "http",
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
