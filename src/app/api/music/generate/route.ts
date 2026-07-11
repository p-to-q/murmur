import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import { createSpendReference } from "@/lib/billing/spend-ref";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { shouldSkipNotesBilling } from "@/lib/billing/session-billing";
import {
  getNotesBalance,
  recordPendingRefund,
  refundNotes,
  spendNotes,
} from "@/lib/db/queries/notes-ledger";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { classifyError } from "@/lib/errors/transient";
import { log } from "@/lib/observability/log";
import { checkBudget } from "@/lib/observability/latency-budgets";
import {
  getMusicEngineMode,
  getMusicServerlessConfig,
  getMusicWorkerUrl,
} from "@/lib/platform/music-worker";
import { notifications } from "@/lib/platform/notifications-server";
import {
  langFromAcceptLanguage,
  songGeneratedNotificationCopy,
} from "@/lib/notifications/notification-copy";
import { scheduleAfterResponse } from "@/lib/platform/request-lifecycle";
import { RunpodError, runJob, getQueueDepth } from "@/lib/platform/runpod-serverless";
import { COST } from "@murmur/core";

export const runtime = "nodejs";
// Vercel Pro ceiling (300 s). Let RunPod finish at its own pace — the client
// spinner already has no cap, so the only real gate is this platform limit.
export const maxDuration = 300;

const ROUTE = "/api/music/generate";
// One hum fans out into three clips and one immediate reroll can fan out again.
// Keep a short burst for a normal creative loop, then cap the 24h GPU budget.
const GENERATE_BURST_RATE_LIMIT = { capacity: 6, refillWindowMs: 60_000 };
const GENERATE_DAILY_RATE_LIMIT = {
  capacity: 48,
  refillWindowMs: 24 * 60 * 60 * 1000,
};
// Must stay below maxDuration so our structured error beats the platform 502.
const WORKER_TIMEOUT_MS = 295_000;
const MAX_PROMPT_CHARS = 300;
const MAX_HUM_BYTES = 4 * 1024 * 1024;
const MIN_DURATION = 2;
const MAX_DURATION = 20;

const LOAD_SHED_QUEUE_THRESHOLD = 5;
const LOAD_SHED_RETRY_AFTER_MS = 15_000;

type MusicRouteError =
  | "prompt_required"
  | "validation_error"
  | "insufficient_notes"
  | "billing_unavailable"
  | "refund_pending"
  | "worker_unconfigured"
  | "worker_unauthorized"
  | "worker_http_error"
  | "worker_overloaded"
  | "client_closed_request"
  | "server_error";

/**
 * Distinct client signal (#232): the generation failed AND the automatic
 * in-request refund could not complete, so a durable `refund:pending` marker
 * was written for the reconcile cron to retry. The UI shows this as "we owe
 * you a note, it's being restored" rather than a generic failure.
 */
const REFUND_PENDING_MESSAGE =
  "Generation failed and your note couldn't be returned right away — it's queued to be restored.";

/** Outcome of the best-effort in-request refund after a failed generation. */
type MusicRefundOutcome = "refunded" | "not_needed" | "pending";

type BillingMode = "ledger" | "dev_fallback";
type SuccessfulSpend = Extract<Awaited<ReturnType<typeof spendNotes>>, { ok: true }>;
type DevFallbackSpend = {
  ok: true;
  ledgerId: null;
  balanceBefore: null;
  balanceAfter: null;
  duplicate: false;
};
type SpendForRefund = SuccessfulSpend | DevFallbackSpend;
type OkAuth = Extract<Awaited<ReturnType<typeof resolveRequestAuth>>, { ok: true }>;

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
 * `melody`), WAV out. Each worker handoff spends one Murmur Note server-side;
 * failed worker calls refund that spend before returning the error.
 */
export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const requestId = getRequestId(request);
  const batchId = readGenerationBatchId(request);
  const spendRef = createSpendReference("music_generate");
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  let spendForRefund: SpendForRefund | null = null;

  // All anonymous traffic resolves to the single "guest" user; keying the
  // bucket by IP for guests keeps one visitor from draining everyone's
  // budget on this GPU-backed endpoint.
  const rateLimitId =
    auth.source === "guest"
      ? `${userId}:${clientIpFromHeaders(request.headers)}`
      : userId;
  const burstRateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "user:burst",
    userId: rateLimitId,
    requestId,
    sessionId: auth.sessionId,
    options: GENERATE_BURST_RATE_LIMIT,
  });
  if (!burstRateLimit.allowed) {
    return rateLimitedResponse(burstRateLimit, requestId);
  }

  const dailyRateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "user:daily",
    userId: rateLimitId,
    requestId,
    sessionId: auth.sessionId,
    options: GENERATE_DAILY_RATE_LIMIT,
  });
  if (!dailyRateLimit.allowed) {
    return rateLimitedResponse(dailyRateLimit, requestId);
  }

  const mode = getMusicEngineMode();
  if (!mode) {
    return fail("worker_unconfigured", "music worker is not configured", 503, {
      requestId, userId, startedAt,
    });
  }

  // Pre-flight load-shed (#230): when the serverless queue is already deep, a
  // new job would sit through a multi-minute cold start and risk exceeding the
  // Vercel timeout — after the note was spent. Shed BEFORE spending, for every
  // account kind (not just local_creator), so a cold pool never charges a note
  // it can't deliver. `getQueueDepth` fails open (null → allow).
  if (mode === "serverless") {
    const serverlessConfig = getMusicServerlessConfig();
    if (serverlessConfig) {
      const depth = await getQueueDepth(serverlessConfig);
      if (depth && depth.inQueue > LOAD_SHED_QUEUE_THRESHOLD) {
        log("music.generate_failed", {
          error_code: "worker_overloaded",
          inQueue: depth.inQueue,
          inProgress: depth.inProgress,
          accountKind: auth.user.accountKind,
          loadShed: true,
        }, {
          route: ROUTE, requestId, userId, level: "warn",
          durationMs: Math.round(performance.now() - startedAt),
        });
        return NextResponse.json(
          {
            error: "worker_overloaded" as const,
            message: "Music generation is busy. Please try again shortly.",
            retryAfterMs: LOAD_SHED_RETRY_AFTER_MS,
            requestId,
          },
          {
            status: 503,
            headers: {
              "X-Request-Id": requestId,
              "Retry-After": String(Math.ceil(LOAD_SHED_RETRY_AFTER_MS / 1000)),
            },
          },
        );
      }
    }
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
    const billing = await prepareMusicGenerationBilling({
      request,
      auth,
      userId,
      sessionId: auth.sessionId,
      requestId,
      spendRef,
      startedAt,
      mode,
      promptLength: prompt.length,
      duration,
      styleMix,
      humBytes: hum ? hum.size : 0,
    });
    if (!billing.ok) {
      return billing.response;
    }
    spendForRefund = billing.spend;

    log("music.generate_requested", {
      mode,
      batchId,
      cost: COST.music_generate,
      balanceBefore: billing.balanceBefore,
      billingMode: billing.billingMode,
      promptChars: prompt.length,
      duration,
      styleMix,
      humBytes: hum ? hum.size : 0,
    }, {
      route: ROUTE, requestId, userId, sessionId: auth.sessionId,
    });

    // The browser aborts superseded clip requests on reroll/navigation; wire
    // that signal through so an abandoned generation is cancelled on the
    // worker and its note refunded, instead of billing for audio nobody can
    // ever hear while it blocks the queue for the replacement batch.
    const result =
      mode === "serverless"
        ? await generateViaServerless(params, requestId, request.signal)
        : await generateViaHttp(params, requestId, request.signal);

    if (!result.ok) {
      const outcome = await refundMusicGenerateSpendIfNeeded({
        spend: spendForRefund,
        requestId,
        userId,
        sessionId: auth.sessionId,
        promptLength: prompt.length,
        duration,
        trigger: result.error,
      });
      spendForRefund = null;
      if (outcome === "pending") {
        return fail("refund_pending", REFUND_PENDING_MESSAGE, 500, {
          requestId, userId, startedAt,
          ext: { trigger: result.error },
        });
      }
      return fail(result.error, result.message, result.status, {
        requestId, userId, startedAt,
        ext: result.ext,
      });
    }

    const genDurationMs = Math.round(performance.now() - startedAt);
    const genBudget = checkBudget("music_generate", genDurationMs);
    log("music.generate_completed", {
      mode,
      batchId,
      bytes: result.audio.byteLength,
      cost: COST.music_generate,
      balanceAfter: billing.spend.balanceAfter,
      billingMode: billing.billingMode,
      generationMs: Number(result.generationMs) || null,
      model: result.model,
      styleMix: result.styleMix,
      budget_exceeded: genBudget.budget_exceeded,
      budget_p95: genBudget.budget_p95,
    }, {
      route: ROUTE, requestId, userId, sessionId: auth.sessionId,
      durationMs: genDurationMs,
    });
    scheduleAfterResponse(() => publishMusicGeneratedNotification({
      userId,
      sessionId: auth.sessionId,
      requestId,
      batchId,
      prompt,
      acceptLanguage: request.headers.get("accept-language"),
    }));

    return new NextResponse(result.audio, {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
        "X-Model": result.model,
        "X-Generation-Ms": result.generationMs,
        "X-Style-Mix": result.styleMix,
      },
    });
  } catch (error) {
    const outcome = await refundMusicGenerateSpendIfNeeded({
      spend: spendForRefund,
      requestId,
      userId,
      sessionId: auth.sessionId,
      promptLength: null,
      duration: null,
      trigger: "route_exception",
    });
    spendForRefund = null;
    if (outcome === "pending") {
      return fail("refund_pending", REFUND_PENDING_MESSAGE, 500, {
        requestId, userId, startedAt,
        ext: {
          trigger: "route_exception",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
    const classified = classifyError(error);
    return fail("server_error", "Music generation failed", 500, {
      requestId, userId, startedAt,
      ext: {
        message: error instanceof Error ? error.message : String(error),
        error_class: classified.class,
      },
    });
  }
}

// The browser groups the sibling clip requests of one Studio fan-out under a
// shared batch id. It only scopes notification identity and log correlation,
// so a malformed value must never fail generation — it just falls back to
// per-request identity.
const GENERATION_BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

function readGenerationBatchId(request: NextRequest): string | null {
  const raw = request.headers.get("x-generation-batch-id")?.trim();
  return raw && GENERATION_BATCH_ID_PATTERN.test(raw) ? raw : null;
}

async function publishMusicGeneratedNotification(input: {
  userId: string;
  sessionId: string | null;
  requestId: string;
  batchId: string | null;
  prompt: string;
  acceptLanguage: string | null;
}) {
  const lang = langFromAcceptLanguage(input.acceptLanguage);
  const copy = songGeneratedNotificationCopy(lang, {
    readyCount: 1,
    totalCount: 1,
  });
  // Sibling clips share the batch id, so their pushes collapse into one OS
  // notification (same tag) and one inbox entry (same notificationId) instead
  // of stacking one alert per clip. The client replaces this slot with the
  // final "N of M ready" summary once the whole batch settles.
  const groupId = input.batchId ?? input.requestId;
  await notifications
    .publish({
      title: copy.title,
      body: copy.body,
      userId: input.userId,
      data: {
        kind: "song_generated",
        tag: `murmur-generation-${groupId}`,
        href: "/studio",
        source: "music-generate",
        requestId: input.requestId,
        batchId: input.batchId,
        sourceId: groupId,
        notificationId: `song_generated:${groupId}`,
        prompt: input.prompt.slice(0, 120),
      },
    })
    .catch((error) => {
      log("notifications.publish_failed", {
        source: "music_generate",
        requestId: input.requestId,
        error: error instanceof Error ? error.message : String(error),
      }, {
        route: ROUTE,
        userId: input.userId,
        sessionId: input.sessionId,
        level: "warn",
      });
    });
}

async function prepareMusicGenerationBilling(options: {
  request: NextRequest;
  auth: OkAuth;
  userId: string;
  sessionId: string | null;
  requestId: string;
  spendRef: string;
  startedAt: number;
  mode: "serverless" | "http";
  promptLength: number;
  duration: number;
  styleMix: number;
  humBytes: number;
}): Promise<
  | {
      ok: true;
      spend: SpendForRefund;
      balanceBefore: number | null;
      billingMode: BillingMode;
    }
  | { ok: false; response: NextResponse }
> {
  if (
    shouldSkipNotesBilling(options.auth)
    || shouldBypassMusicBillingForLocalDemo(options.request, options.auth)
  ) {
    return {
      ok: true,
      spend: {
        ok: true,
        ledgerId: null,
        balanceBefore: null,
        balanceAfter: null,
        duplicate: false,
      },
      balanceBefore: null,
      billingMode: "dev_fallback",
    };
  }

  let balance: Awaited<ReturnType<typeof getNotesBalance>>;
  try {
    balance = await getNotesBalance(options.userId);
  } catch (error) {
    return {
      ok: false,
      response: fail("billing_unavailable", "User balance is unavailable", 503, {
        requestId: options.requestId,
        userId: options.userId,
        startedAt: options.startedAt,
        ext: { message: error instanceof Error ? error.message : String(error) },
      }),
    };
  }

  if (!balance.ok) {
    return {
      ok: false,
      response: fail("billing_unavailable", "User balance is unavailable", 503, {
        requestId: options.requestId,
        userId: options.userId,
        startedAt: options.startedAt,
      }),
    };
  }

  if (balance.notes < COST.music_generate) {
    return {
      ok: false,
      response: fail("insufficient_notes", "Not enough Murmur Notes", 402, {
        requestId: options.requestId,
        userId: options.userId,
        startedAt: options.startedAt,
        ext: { currentBalance: balance.notes, cost: COST.music_generate },
        body: { currentBalance: balance.notes, cost: COST.music_generate },
      }),
    };
  }

  let spend: Awaited<ReturnType<typeof spendNotes>>;
  try {
    spend = await spendNotes({
      userId: options.userId,
      cost: COST.music_generate,
      reason: "spend:music_generate",
      externalRef: options.spendRef,
      metadata: {
        requestId: options.requestId,
        route: ROUTE,
        phase: "preflight",
        mode: options.mode,
        promptLength: options.promptLength,
        duration: options.duration,
        styleMix: options.styleMix,
        humBytes: options.humBytes,
      },
    });
  } catch (error) {
    return {
      ok: false,
      response: fail("billing_unavailable", "Could not spend Murmur Notes", 503, {
        requestId: options.requestId,
        userId: options.userId,
        startedAt: options.startedAt,
        ext: { message: error instanceof Error ? error.message : String(error) },
      }),
    };
  }

  if (!spend.ok) {
    const response =
      spend.reason === "insufficient_notes"
        ? fail("insufficient_notes", "Not enough Murmur Notes", 402, {
            requestId: options.requestId,
            userId: options.userId,
            startedAt: options.startedAt,
            ext: { currentBalance: spend.currentBalance, cost: COST.music_generate },
            body: { currentBalance: spend.currentBalance, cost: COST.music_generate },
          })
        : fail("billing_unavailable", "User balance is unavailable", 503, {
            requestId: options.requestId,
            userId: options.userId,
            startedAt: options.startedAt,
          });
    return { ok: false, response };
  }

  if (!spend.duplicate) {
    log("notes.spent", {
      reason: "spend:music_generate",
      cost: COST.music_generate,
      balanceAfter: spend.balanceAfter,
      ledgerId: spend.ledgerId,
    }, {
      route: ROUTE,
      requestId: options.requestId,
      userId: options.userId,
      sessionId: options.sessionId,
    });
  }

  return {
    ok: true,
    spend,
    balanceBefore: spend.balanceBefore,
    billingMode: "ledger",
  };
}

function shouldBypassMusicBillingForLocalDemo(
  request: NextRequest,
  auth: OkAuth,
): boolean {
  if (auth.user.accountKind === "local_creator") return false;
  const host = request.nextUrl?.hostname || safeHostnameFromUrl(request.url);
  return shouldBypassBillingInDevelopment({ host });
}

async function refundMusicGenerateSpendIfNeeded(options: {
  spend: SpendForRefund | null;
  requestId: string;
  userId: string;
  sessionId: string | null;
  promptLength: number | null;
  duration: number | null;
  trigger: string;
}): Promise<MusicRefundOutcome> {
  if (!options.spend || options.spend.ledgerId === null || options.spend.duplicate) {
    return "not_needed";
  }
  const ledgerId = options.spend.ledgerId;

  try {
    const refund = await refundNotes({
      originalLedgerId: ledgerId,
      metadata: {
        requestId: options.requestId,
        promptLength: options.promptLength,
        duration: options.duration,
        trigger: options.trigger,
      },
    });

    if (refund.ok) {
      if (!refund.duplicate) {
        log("notes.granted", {
          reason: "refund:spend",
          delta: refund.amount,
          balanceAfter: refund.balanceAfter,
          originalLedgerId: refund.originalLedgerId,
          refundLedgerId: refund.refundLedgerId,
        }, {
          route: ROUTE,
          requestId: options.requestId,
          userId: options.userId,
          sessionId: options.sessionId,
          level: "warn",
        });
      }
      return "refunded";
    }

    return recordMusicRefundPending({
      ledgerId,
      failureReason: refund.reason,
      requestId: options.requestId,
      userId: options.userId,
      sessionId: options.sessionId,
      trigger: options.trigger,
    });
  } catch (error) {
    return recordMusicRefundPending({
      ledgerId,
      failureReason: error instanceof Error ? error.message : String(error),
      requestId: options.requestId,
      userId: options.userId,
      sessionId: options.sessionId,
      trigger: options.trigger,
    });
  }
}

/**
 * In-request refund failed: persist a durable `refund:pending` marker (#232)
 * so the reconcile cron can retry the reversal idempotently, and return
 * "pending" so the route emits the distinct client signal. Even if the marker
 * write itself fails we still return "pending" — the user is owed a note either
 * way — but downgrade the log to MANUAL_REFUND_REQUIRED since nothing durable
 * was recorded for the cron to find.
 */
async function recordMusicRefundPending(input: {
  ledgerId: string;
  failureReason: string;
  requestId: string;
  userId: string;
  sessionId: string | null;
  trigger: string;
}): Promise<"pending"> {
  let pendingRecorded = false;
  try {
    const pending = await recordPendingRefund({
      userId: input.userId,
      originalLedgerId: input.ledgerId,
      amount: COST.music_generate,
      spendReason: "spend:music_generate",
      requestId: input.requestId,
      source: "music_generate_refund_failed",
      metadata: { trigger: input.trigger, refundError: input.failureReason },
    });
    pendingRecorded = pending.ok;
  } catch (markerError) {
    log("notes.refund_failed", {
      requestLedgerId: input.ledgerId,
      reason: input.failureReason,
      pendingMarkerError: markerError instanceof Error ? markerError.message : String(markerError),
      reconciliation: "MANUAL_REFUND_REQUIRED",
      trigger: input.trigger,
    }, {
      route: ROUTE,
      requestId: input.requestId,
      userId: input.userId,
      sessionId: input.sessionId,
      level: "error",
    });
    return "pending";
  }

  log(
    pendingRecorded ? "notes.refund_pending" : "notes.refund_failed",
    {
      requestLedgerId: input.ledgerId,
      reason: input.failureReason,
      reconciliation: pendingRecorded ? "REFUND_PENDING_RECORDED" : "MANUAL_REFUND_REQUIRED",
      trigger: input.trigger,
    },
    {
      route: ROUTE,
      requestId: input.requestId,
      userId: input.userId,
      sessionId: input.sessionId,
      level: pendingRecorded ? "warn" : "error",
    },
  );
  return "pending";
}

function safeHostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Production path: invoke the RunPod Serverless endpoint (JSON + base64). */
async function generateViaServerless(
  params: GenerateParams,
  requestId: string,
  signal?: AbortSignal,
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
    output = await runJob(config, input, { budgetMs: WORKER_TIMEOUT_MS, signal });
  } catch (error) {
    if (error instanceof RunpodError) {
      if (error.kind === "aborted") {
        return {
          ok: false,
          error: "client_closed_request",
          message: "Client aborted the generation request",
          status: 499,
        };
      }
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
  signal?: AbortSignal,
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

  const timeoutSignal = AbortSignal.timeout(WORKER_TIMEOUT_MS);
  let workerRes: Response;
  try {
    workerRes = await fetch(`${workerBase.replace(/\/+$/, "")}/generate`, {
      method: "POST",
      body: workerForm,
      headers,
      signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal,
    });
  } catch (error) {
    if (signal?.aborted) {
      return {
        ok: false,
        error: "client_closed_request",
        message: "Client aborted the generation request",
        status: 499,
      };
    }
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
    } catch (parseError) {
      log(
        "music.worker_error_parse_failed",
        {
          status: workerRes.status,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        },
        { route: ROUTE, requestId, level: "warn" },
      );
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
    body?: Record<string, unknown>;
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
    { error, message, requestId: options.requestId, ...options.body },
    { status, headers: { "X-Request-Id": options.requestId } },
  );
}
