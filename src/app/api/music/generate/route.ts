import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";
import { getMusicWorkerUrl } from "@/lib/platform/music-worker";

export const runtime = "nodejs";
// Generation proxies a 10-30s model call (plus a possible cold model load);
// don't let the platform's default function timeout cut it off mid-render.
export const maxDuration = 120;

const ROUTE = "/api/music/generate";
// One hum fans out into three clips and rerolls fan out again — the budget
// is per-clip, so keep it well above the transcribe route's.
const GENERATE_RATE_LIMIT = { capacity: 30, refillWindowMs: 60_000 };
// Must stay below maxDuration (120 s): if the worker fetch outlives the
// function, the platform kills us mid-wait and the client gets an opaque
// 502 instead of our structured timeout error.
const WORKER_TIMEOUT_MS = 110_000;
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

/**
 * POST /api/music/generate
 *
 * Proxies a clip request to the local Magenta RealTime worker. Multipart in
 * (`prompt`, `duration`, optional `styleMix` + `hum` recording), WAV out.
 * Generation itself is free — the hum that started the flow already spent
 * the note in /api/transcribe.
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

  const workerBase = getMusicWorkerUrl();
  if (!workerBase) {
    return fail("worker_unconfigured", "MUSIC_WORKER_URL is not configured", 503, {
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

    const hum = formData.get("hum");
    if (hum instanceof File && hum.size > MAX_HUM_BYTES) {
      return fail("validation_error", "hum recording is too large", 413, {
        requestId, userId, startedAt,
      });
    }

    const workerForm = new FormData();
    workerForm.append("prompt", prompt);
    workerForm.append("duration", String(duration));
    if (hum instanceof File && hum.size > 0 && styleMix > 0) {
      workerForm.append("style_mix", String(styleMix));
      workerForm.append("hum", hum, hum.name || "hum.webm");
    }

    const headers = new Headers({ "X-Request-Id": requestId });
    const token = process.env.MUSIC_WORKER_TOKEN?.trim();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    log("music.generate_requested", {
      promptChars: prompt.length,
      duration,
      styleMix,
      humBytes: hum instanceof File ? hum.size : 0,
    }, {
      route: ROUTE, requestId, userId, sessionId: auth.sessionId,
    });

    let workerRes: Response;
    try {
      workerRes = await fetch(`${workerBase.replace(/\/+$/, "")}/generate`, {
        method: "POST",
        body: workerForm,
        headers,
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      });
    } catch (error) {
      return fail(
        "worker_http_error",
        error instanceof Error ? error.message : "Music worker request failed",
        502,
        { requestId, userId, startedAt },
      );
    }

    if (!workerRes.ok) {
      // Surface the worker's own error payload in our logs — without it,
      // "HTTP 500" hides whether generation failed, auth drifted, or the
      // worker was mid-load.
      let workerDetail: unknown = null;
      try {
        workerDetail = (await workerRes.json()) as unknown;
      } catch {
        // non-JSON body (tunnel error pages etc.) — nothing to extract
      }
      const unauthorized = workerRes.status === 401 || workerRes.status === 403;
      return fail(
        unauthorized ? "worker_unauthorized" : "worker_http_error",
        unauthorized
          ? "Music worker rejected our token (MUSIC_WORKER_TOKEN out of sync?)"
          : `Music worker returned HTTP ${workerRes.status}`,
        502,
        {
          requestId, userId, startedAt,
          ext: { workerStatus: workerRes.status, workerDetail },
        },
      );
    }

    const audio = await workerRes.arrayBuffer();
    log("music.generate_completed", {
      bytes: audio.byteLength,
      generationMs: Number(workerRes.headers.get("x-generation-ms")) || null,
      model: workerRes.headers.get("x-model"),
      styleMix: workerRes.headers.get("x-style-mix"),
    }, {
      route: ROUTE, requestId, userId, sessionId: auth.sessionId,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return new NextResponse(audio, {
      headers: {
        "Content-Type": workerRes.headers.get("content-type") ?? "audio/wav",
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
        "X-Model": workerRes.headers.get("x-model") ?? "",
        "X-Generation-Ms": workerRes.headers.get("x-generation-ms") ?? "",
      },
    });
  } catch (error) {
    return fail("server_error", "Music generation failed", 500, {
      requestId, userId, startedAt,
      ext: { message: error instanceof Error ? error.message : String(error) },
    });
  }
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
