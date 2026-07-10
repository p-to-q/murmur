import { NextResponse } from "next/server";
import {
  getMusicEngineMode,
  getRequestedMusicEngineMode,
  getMusicServerlessConfig,
  getMusicWorkerUrl,
  isMusicWorkerConfigured,
} from "@/lib/platform/music-worker";
import { endpointHealth, parseQueueDepth } from "@/lib/platform/runpod-serverless";

export const runtime = "nodejs";

type PublicMusicHealth = {
  available: boolean;
  configured: boolean;
  mode?: "serverless" | "http" | null;
  requestedMode?: "serverless" | "http" | "auto";
  reason: "unconfigured" | "unauthorized" | "unreachable" | "degraded" | `http_${number}` | null;
  estimatedWaitMs?: number | null;
};

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
 *
 * The response is intentionally minimal: transport `mode`/`requestedMode` plus a
 * coarse availability `reason`. Worker counts, model names, and raw load-error
 * strings stay server-side so this public endpoint cannot leak deployment shape.
 */
export async function GET() {
  const mode = getMusicEngineMode();
  if (!mode) {
    const requestedMode = getRequestedMusicEngineMode();
    return publicHealth({
      available: false,
      configured: false,
      mode: requestedMode === "auto" ? null : requestedMode,
      requestedMode,
      reason: "unconfigured",
    });
  }

  return mode === "serverless" ? serverlessHealth() : httpHealth();
}

async function serverlessHealth() {
  const config = getMusicServerlessConfig();
  if (!config) {
    return publicHealth({
      available: false,
      configured: false,
      mode: "serverless",
      requestedMode: getRequestedMusicEngineMode(),
      reason: "unconfigured",
    });
  }

  try {
    const { ok, status, body } = await endpointHealth(config, AbortSignal.timeout(12_000));
    if (!ok) {
      const unauthorized = status === 401 || status === 403;
      return publicHealth({
        available: false,
        configured: true,
        mode: "serverless",
        requestedMode: getRequestedMusicEngineMode(),
        reason: unauthorized ? "unauthorized" : `http_${status}`,
      });
    }
    // Reuse the body we already fetched — a second /health round-trip would
    // double the latency and could disagree with the availability answer above.
    const depth = parseQueueDepth(body);
    const estimatedWaitMs = depth
      ? estimateWaitFromQueue(depth.inQueue, depth.inProgress, depth.workers.total)
      : null;
    return publicHealth({
      available: true,
      configured: true,
      mode: "serverless",
      requestedMode: getRequestedMusicEngineMode(),
      reason: null,
      estimatedWaitMs,
    });
  } catch {
    return publicHealth({
      available: false,
      configured: true,
      mode: "serverless",
      requestedMode: getRequestedMusicEngineMode(),
      reason: "unreachable",
    });
  }
}

async function httpHealth() {
  const configured = isMusicWorkerConfigured();
  const workerBase = getMusicWorkerUrl();
  if (!workerBase) {
    return publicHealth({
      available: false,
      configured: false,
      mode: "http",
      requestedMode: getRequestedMusicEngineMode(),
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
      return publicHealth({
        available: false,
        configured,
        mode: "http",
        requestedMode: getRequestedMusicEngineMode(),
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
    return publicHealth({
      available,
      configured,
      mode: "http",
      requestedMode: getRequestedMusicEngineMode(),
      reason: available ? null : "degraded",
    });
  } catch {
    return publicHealth({
      available: false,
      configured,
      mode: "http",
      requestedMode: getRequestedMusicEngineMode(),
      reason: "unreachable",
    });
  }
}

const AVG_GENERATION_MS = 30_000;
const COLD_START_MS = 45_000;

function estimateWaitFromQueue(
  inQueue: number,
  inProgress: number,
  totalWorkers: number,
): number | null {
  if (inQueue === 0 && inProgress === 0) return 0;
  const effectiveWorkers = Math.max(1, totalWorkers);
  const coldStartPenalty = totalWorkers === 0 ? COLD_START_MS : 0;
  const pendingJobs = inQueue + inProgress;
  return Math.round(
    coldStartPenalty + (pendingJobs / effectiveWorkers) * AVG_GENERATION_MS,
  );
}

function publicHealth(body: PublicMusicHealth): NextResponse {
  return NextResponse.json(body);
}
