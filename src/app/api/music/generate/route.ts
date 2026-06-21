import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";
import {
  getMusicEngineMode,
  getMusicServerlessConfig,
  getMusicWorkerUrl,
} from "@/lib/platform/music-worker";
import { RunpodError, runJob } from "@/lib/platform/runpod-serverless";

export const runtime = "nodejs";
// Vercel Pro ceiling (300 s). Let RunPod finish at its own pace — the client
// spinner already has no cap, so the only real gate is this platform limit.
export const maxDuration = 300;

const ROUTE = "/api/music/generate";
// One hum fans out into three clips and rerolls fan out again — the budget
// is per-clip, so keep it well above the transcribe route's.
const GENERATE_RATE_LIMIT = { capacity: 30, refillWindowMs: 60_000 };
// Must stay below maxDuration so our structured error beats the platform 502.
const WORKER_TIMEOUT_MS = 295_000;
const MAX_PROMPT_CHARS = 300;
const MAX_HUM_BYTES = 4 * 1024 * 1024;
const MIN_DURATION = 2;
const MAX_DURATION = 20;

type MusicRouteError =
  | "prompt_required"
  | "validation_error"
  | "worker_unconfigured"
  | "worker_unauthorized"
  | "worker_http_error"
  | "server_error";

interface GenerateParams {
  prompt: string;
  duration: number;
  styleMix: number;
  hum: File | null;
  melody: string;
}

type GenerateResult =
  | {
      ok: true;
      audio: ArrayBuffer;
      contentType: string;
      model: string;
      generationMs: string;
      styleMix: string;
    }
  | {
      ok: false;
      error: MusicRouteError;
      message: string;
      status: number;
      ext?: Record<string, unknown>;
    };

/**
 * POST /api/music/generate
 *
 * Proxies a clip request to the Magenta RealTime worker — RunPod Serverless in
 * production, or the local FastAPI worker in dev (see getMusicEngineMode).
 * Multipart in (`prompt`, `duration`, optional `styleMix` + `hum` recording +
 * `melody`), WAV out. Generation itself is free — the hum that started the flow
 * already spent the note in /api/transcribe.
 */
export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  // All anonymous traffic resolves to the single "guest" user; keying the
  // bucket by IP for guests keeps one visitor from draining everyone's
  // budget on this GPU-backed endpoint.
  const rateLimitId =
    auth.source === "guest"
      ? `${userId}:${clientIpFromHeaders(request.headers)}`
      : userId;
  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "user",
    userId: rateLimitId,
    requestId,
    sessionId: auth.sessionId,
    options: GENERATE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  const mode = getMusicEngineMode();
  if (!mode) {
    return fail("worker_unconfigured", "music worker is not configured", 503, {
      requestId, userId, startedAt,
    });
  }

  try {
    const formData = await request.formData();
    const promptRaw = formData.get("prompt");
    const prompt = typeof promptRaw === "string" ? promptRaw.trim() : "";
    if (!prompt) {
      return fail("prompt_required", "prompt is required", 400, {
        requestId, userId, startedAt,
      });
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return fail("validation_error", "prompt is too long", 400, {
        requestId, userId, startedAt,
      });
    }

    const durationRaw = Number(formData.get("duration") ?? 10);
    const duration = Math.min(
      MAX_DURATION,
      Math.max(MIN_DURATION, Number.isFinite(durationRaw) ? durationRaw : 10),
    );

    const styleMixRaw = Number(formData.get("styleMix") ?? 0);
    const styleMix = Math.min(
      0.8,
      Math.max(0, Number.isFinite(styleMixRaw) ? styleMixRaw : 0),
    );

    const humValue = formData.get("hum");
    const hum = humValue instanceof File ? humValue : null;
    if (hum && hum.size > MAX_HUM_BYTES) {
      return fail("validation_error", "hum recording is too large", 413, {
        requestId, userId, startedAt,
      });
    }

    const melodyRaw = formData.get("melody");
    const melody = typeof melodyRaw === "string" ? melodyRaw.trim() : "";

    const params: GenerateParams = { prompt, duration, styleMix, hum, melody };

    log("music.generate_requested", {
      mode,
      promptChars: prompt.length,
      duration,
      styleMix,
      humBytes: hum ? hum.size : 0,
    }, {
      route: ROUTE, requestId, userId, sessionId: auth.sessionId,
    });

    const result =
      mode === "serverless"
        ? await generateViaServerless(params, requestId)
        : await generateViaHttp(params, requestId);

    if (!result.ok) {
      return fail(result.error, result.message, result.status, {
        requestId, userId, startedAt, ext: result.ext,
      });
    }

    log("music.generate_completed", {
      mode,
      bytes: result.audio.byteLength,
      generationMs: Number(result.generationMs) || null,
      model: result.model,
      styleMix: result.styleMix,
    }, {
      route: ROUTE, requestId, userId, sessionId: auth.sessionId,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return new NextResponse(result.audio, {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
        "X-Model": result.model,
        "X-Generation-Ms": result.generationMs,
      },
    });
  } catch (error) {
    return fail("server_error", "Music generation failed", 500, {
      requestId, userId, startedAt,
      ext: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

/** Production path: invoke the RunPod Serverless endpoint (JSON + base64). */
async function generateViaServerless(
  params: GenerateParams,
  requestId: string,
): Promise<GenerateResult> {
  const config = getMusicServerlessConfig();
  if (!config) {
    return { ok: false, error: "worker_unconfigured", message: "RunPod endpoint not configured", status: 503 };
  }

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    duration: params.duration,
    request_id: requestId,
  };
  if (params.melody) input.melody = params.melody;
  if (params.hum && params.hum.size > 0 && params.styleMix > 0) {
    input.style_mix = params.styleMix;
    input.hum_b64 = Buffer.from(await params.hum.arrayBuffer()).toString("base64");
  }

  let output: Record<string, unknown>;
  try {
    output = await runJob(config, input, { budgetMs: WORKER_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof RunpodError) {
      return {
        ok: false,
        error: error.kind === "unauthorized" ? "worker_unauthorized" : "worker_http_error",
        message:
          error.kind === "unauthorized"
            ? "RunPod rejected our API key (RUNPOD_API_KEY out of sync?)"
            : error.message,
        status: 502,
        ext: { runpodKind: error.kind, runpodDetail: error.detail },
      };
    }
    return {
      ok: false,
      error: "worker_http_error",
      message: error instanceof Error ? error.message : "RunPod request failed",
      status: 502,
    };
  }

  const audioB64 = output.audio_b64;
  if (typeof audioB64 !== "string" || !audioB64) {
    return {
      ok: false,
      error: "worker_http_error",
      message: "RunPod job returned no audio",
      status: 502,
      ext: { output },
    };
  }

  // Slice out exactly this clip's bytes into a standalone ArrayBuffer: Node
  // pools small Buffer allocations into a shared backing store, and NextResponse
  // wants a plain ArrayBuffer (a Buffer is generic over ArrayBufferLike).
  const decoded = Buffer.from(audioB64, "base64");
  const audio = decoded.buffer.slice(
    decoded.byteOffset,
    decoded.byteOffset + decoded.byteLength,
  ) as ArrayBuffer;

  return {
    ok: true,
    audio,
    contentType: "audio/wav",
    model: typeof output.model === "string" ? output.model : "",
    generationMs: output.generation_ms != null ? String(output.generation_ms) : "",
    styleMix: typeof output.style_mix === "string" ? output.style_mix : "",
  };
}

/** Dev/legacy path: proxy multipart to the HTTP worker (`MUSIC_WORKER_URL`). */
async function generateViaHttp(
  params: GenerateParams,
  requestId: string,
): Promise<GenerateResult> {
  const workerBase = getMusicWorkerUrl();
  if (!workerBase) {
    return { ok: false, error: "worker_unconfigured", message: "MUSIC_WORKER_URL is not configured", status: 503 };
  }

  const workerForm = new FormData();
  workerForm.append("prompt", params.prompt);
  workerForm.append("duration", String(params.duration));
  if (params.melody) {
    workerForm.append("melody", params.melody);
  }
  if (params.hum && params.hum.size > 0 && params.styleMix > 0) {
    workerForm.append("style_mix", String(params.styleMix));
    workerForm.append("hum", params.hum, params.hum.name || "hum.webm");
  }

  const headers = new Headers({ "X-Request-Id": requestId });
  const token = process.env.MUSIC_WORKER_TOKEN?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let workerRes: Response;
  try {
    workerRes = await fetch(`${workerBase.replace(/\/+$/, "")}/generate`, {
      method: "POST",
      body: workerForm,
      headers,
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      error: "worker_http_error",
      message: error instanceof Error ? error.message : "Music worker request failed",
      status: 502,
    };
  }

  if (!workerRes.ok) {
    // Surface the worker's own error payload — without it, "HTTP 500" hides
    // whether generation failed, auth drifted, or the worker was mid-load.
    let workerDetail: unknown = null;
    try {
      workerDetail = (await workerRes.json()) as unknown;
    } catch {
      // non-JSON body (tunnel error pages etc.) — nothing to extract
    }
    const unauthorized = workerRes.status === 401 || workerRes.status === 403;
    return {
      ok: false,
      error: unauthorized ? "worker_unauthorized" : "worker_http_error",
      message: unauthorized
        ? "Music worker rejected our token (MUSIC_WORKER_TOKEN out of sync?)"
        : `Music worker returned HTTP ${workerRes.status}`,
      status: 502,
      ext: { workerStatus: workerRes.status, workerDetail },
    };
  }

  return {
    ok: true,
    audio: await workerRes.arrayBuffer(),
    contentType: workerRes.headers.get("content-type") ?? "audio/wav",
    model: workerRes.headers.get("x-model") ?? "",
    generationMs: workerRes.headers.get("x-generation-ms") ?? "",
    styleMix: workerRes.headers.get("x-style-mix") ?? "",
  };
}

function fail(
  error: MusicRouteError,
  message: string,
  status: number,
  options: {
    requestId: string;
    userId: string;
    startedAt: number;
    ext?: Record<string, unknown>;
  },
) {
  log("music.generate_failed", {
    error_code: error,
    ...options.ext,
  }, {
    route: ROUTE,
    requestId: options.requestId,
    userId: options.userId,
    durationMs: Math.round(performance.now() - options.startedAt),
    level: status >= 500 ? "error" : "warn",
  });

  return NextResponse.json(
    { error, message, requestId: options.requestId },
    { status, headers: { "X-Request-Id": options.requestId } },
  );
}
