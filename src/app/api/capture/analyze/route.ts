import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { shouldSkipNotesBilling } from "@/lib/billing/session-billing";
import { getNotesBalance, refundNotes, spendNotes } from "@/lib/db/queries/notes-ledger";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";
import {
  AudioWorkerError,
  isInstrumentId,
  isMelodyCarrier,
  transcribeWithAudioWorker,
} from "@/lib/platform/audio-worker";
import {
  classifySpeechTranscription,
  getSpeechRecognitionProvider,
  SpeechRecognitionError,
} from "@/lib/platform/speech-recognition";
import { COST } from "@murmur/core";

export const runtime = "nodejs";
export const maxDuration = 90;

const ROUTE = "/api/capture/analyze";
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const RATE_LIMIT = { capacity: 10, refillWindowMs: 60_000 };

type CaptureAnalyzeError =
  | "audio_required"
  | "audio_too_large"
  | "validation_error"
  | "insufficient_notes"
  | "billing_unavailable"
  | "worker_unconfigured"
  | "worker_http_error"
  | "worker_invalid_response"
  | "no_voiced_frames"
  | "server_error";

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(request, {
    allowGuestPreview: shouldAllowGuestCapturePreview(request),
  });
  if (!auth.ok) return auth.response;

  const userId = auth.user.id;
  const rateLimitUserId =
    auth.source === "guest"
      ? `${userId}:${clientIpFromHeaders(request.headers)}`
      : userId;
  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "user",
    userId: rateLimitUserId,
    requestId,
    sessionId: auth.sessionId,
    options: RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    const targetInstrumentRaw = formData.get("targetInstrument");
    const targetInstrument =
      typeof targetInstrumentRaw === "string" && targetInstrumentRaw.trim()
        ? targetInstrumentRaw.trim()
        : "piano";

    if (!(audio instanceof File) || audio.size === 0) {
      return fail("audio_required", "Audio file is required", 400, {
        requestId,
        userId,
        startedAt,
      });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return fail("audio_too_large", "Audio file must be 2 MB or smaller", 413, {
        requestId,
        userId,
        startedAt,
        ext: { bytes: audio.size },
      });
    }
    if (!isInstrumentId(targetInstrument) || !isMelodyCarrier(targetInstrument)) {
      return fail(
        "validation_error",
        "targetInstrument must be a valid melody instrument",
        400,
        {
          requestId,
          userId,
          startedAt,
          ext: { targetInstrument },
        },
      );
    }

    const provider = getSpeechRecognitionProvider();
    if (provider) {
      try {
        const speech = await provider.transcribeSpeech(audio, { requestId });
        const decision = classifySpeechTranscription(speech);
        if (decision.kind === "voice") {
          log("capture.voice_detected", {
            language: decision.language,
            confidence: decision.confidence,
            diagnostics: decision.diagnostics,
          }, {
            route: ROUTE,
            requestId,
            userId,
            sessionId: auth.sessionId,
            durationMs: Math.round(performance.now() - startedAt),
          });
          return NextResponse.json(decision, {
            headers: { "X-Request-Id": requestId },
          });
        }
      } catch (error) {
        log("capture.asr_failed", {
          code: error instanceof SpeechRecognitionError ? error.code : "unknown",
          message: error instanceof Error ? error.message : String(error),
          fallback: "hum",
        }, {
          route: ROUTE,
          requestId,
          userId,
          sessionId: auth.sessionId,
          level: "warn",
        });
      }
    }

    const billing = await prepareHumBilling({
      request,
      auth,
      userId,
      requestId,
      startedAt,
      targetInstrument,
    });
    if (!billing.ok) return billing.response;

    const transcription = await transcribeWithAudioWorker({
      audio,
      targetInstrument,
      requestId,
    }).catch(async (error) => {
      await refundHumSpendIfNeeded({
        spend: billing.spend,
        requestId,
        userId,
        sessionId: auth.sessionId,
        targetInstrument,
      });
      throw error;
    });
    log("capture.hum_detected", {
      provider: transcription.provider,
      notes: transcription.cleanMelody.notes.length,
      targetInstrument,
      cost: COST.hum,
      balanceAfter: billing.spend.balanceAfter,
      billingMode: billing.billingMode,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return NextResponse.json(
      {
        kind: "hum",
        transcription,
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    if (error instanceof AudioWorkerError) {
      return fail(error.code, error.message, error.status, {
        requestId,
        userId,
        startedAt,
      });
    }
    return fail("server_error", "Capture analysis failed", 500, {
      requestId,
      userId,
      startedAt,
      ext: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

type SpendForRefund =
  | Extract<Awaited<ReturnType<typeof spendNotes>>, { ok: true }>
  | {
      ok: true;
      ledgerId: null;
      balanceBefore: null;
      balanceAfter: null;
      duplicate: false;
    };

async function prepareHumBilling(options: {
  request: NextRequest;
  auth: Extract<Awaited<ReturnType<typeof resolveRequestAuth>>, { ok: true }>;
  userId: string;
  requestId: string;
  startedAt: number;
  targetInstrument: string;
}): Promise<
  | { ok: true; spend: SpendForRefund; billingMode: "ledger" | "dev_fallback" }
  | { ok: false; response: NextResponse }
> {
  if (
    shouldSkipNotesBilling(options.auth) ||
    shouldBypassHumBillingForLocalDemo(options.request, options.auth)
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
      billingMode: "dev_fallback",
    };
  }

  const balance = await getNotesBalance(options.userId).catch(() => null);
  if (!balance?.ok) {
    return {
      ok: false,
      response: fail("billing_unavailable", "User balance is unavailable", 503, {
        requestId: options.requestId,
        userId: options.userId,
        startedAt: options.startedAt,
      }),
    };
  }
  if (balance.notes < COST.hum) {
    return {
      ok: false,
      response: fail("insufficient_notes", "Not enough Murmur Notes", 402, {
        requestId: options.requestId,
        userId: options.userId,
        startedAt: options.startedAt,
        body: { currentBalance: balance.notes, cost: COST.hum },
        ext: { currentBalance: balance.notes, cost: COST.hum },
      }),
    };
  }

  const spend = await spendNotes({
    userId: options.userId,
    cost: COST.hum,
    reason: "spend:hum",
    externalRef: `capture_hum:${options.requestId}`,
    metadata: {
      requestId: options.requestId,
      route: ROUTE,
      targetInstrument: options.targetInstrument,
    },
  }).catch(() => null);

  if (!spend?.ok) {
    return {
      ok: false,
      response: fail(
        spend?.reason === "insufficient_notes" ? "insufficient_notes" : "billing_unavailable",
        spend?.reason === "insufficient_notes" ? "Not enough Murmur Notes" : "Could not spend Murmur Notes",
        spend?.reason === "insufficient_notes" ? 402 : 503,
        {
          requestId: options.requestId,
          userId: options.userId,
          startedAt: options.startedAt,
          body:
            spend?.reason === "insufficient_notes"
              ? { currentBalance: spend.currentBalance, cost: COST.hum }
              : undefined,
        },
      ),
    };
  }

  return { ok: true, spend, billingMode: "ledger" };
}

function shouldBypassHumBillingForLocalDemo(
  request: NextRequest,
  auth: Extract<Awaited<ReturnType<typeof resolveRequestAuth>>, { ok: true }>,
): boolean {
  if (auth.user.accountKind === "local_creator") return false;
  const host = request.nextUrl?.hostname || safeHostnameFromUrl(request.url);
  return shouldBypassBillingInDevelopment({ host });
}

async function refundHumSpendIfNeeded(options: {
  spend: SpendForRefund;
  requestId: string;
  userId: string;
  sessionId: string | null;
  targetInstrument: string;
}): Promise<void> {
  if (options.spend.ledgerId === null || options.spend.duplicate) return;
  try {
    const refund = await refundNotes({
      originalLedgerId: options.spend.ledgerId,
      metadata: {
        requestId: options.requestId,
        targetInstrument: options.targetInstrument,
        trigger: "capture_hum_worker_failed",
      },
    });
    if (refund.ok) return;
    log("notes.refund_failed", {
      requestLedgerId: options.spend.ledgerId,
      reason: refund.reason,
    }, {
      route: ROUTE,
      requestId: options.requestId,
      userId: options.userId,
      sessionId: options.sessionId,
      level: "error",
    });
  } catch (error) {
    log("notes.refund_failed", {
      requestLedgerId: options.spend.ledgerId,
      reason: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      requestId: options.requestId,
      userId: options.userId,
      sessionId: options.sessionId,
      level: "error",
    });
  }
}

function shouldAllowGuestCapturePreview(request: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const host = request.nextUrl?.hostname || safeHostnameFromUrl(request.url);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function safeHostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function fail(
  error: CaptureAnalyzeError,
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
  log("capture.analyze_failed", {
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
