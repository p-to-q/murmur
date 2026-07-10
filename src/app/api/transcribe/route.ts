import { NextRequest, NextResponse } from "next/server";
import {
  AudioWorkerError,
  isInstrumentId,
  isMelodyCarrier,
  transcribeWithAudioWorker,
} from "@/lib/platform/audio-worker";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth, type ResolvedRequestAuth } from "@/lib/auth";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { shouldSkipNotesBilling } from "@/lib/billing/session-billing";
import { getNotesBalance, refundNotes, spendNotes } from "@/lib/db/queries/notes-ledger";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { classifyError } from "@/lib/errors/transient";
import { log } from "@/lib/observability/log";
import { checkBudget } from "@/lib/observability/latency-budgets";
import { COST } from "@murmur/core";

export type TranscribeStreamEvent =
  | { phase: "billing_ok"; balanceBefore: number | null }
  | { phase: "worker_started" }
  | { phase: "complete"; result: unknown }
  | { phase: "error"; error: string; message: string; status: number; requestId: string; currentBalance?: number | null };

export const runtime = "nodejs";
// Pitch detection on the worker can take tens of seconds for long hums.
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const ROUTE = "/api/transcribe";
const TRANSCRIBE_RATE_LIMIT = { capacity: 10, refillWindowMs: 60_000 };

type TranscribeRouteError =
  | "audio_required"
  | "audio_too_large"
  | "validation_error"
  | "worker_unconfigured"
  | "worker_http_error"
  | "worker_invalid_response"
  | "no_voiced_frames"
  | "insufficient_notes"
  | "billing_unavailable"
  | "server_error";

type BillingMode = "ledger" | "dev_fallback";

/**
 * POST /api/transcribe
 *
 * Server-authoritative transcription boundary. The browser uploads captured
 * audio; the route validates the request, calls the audio worker, and returns
 * a polished/scored melody. Fixture fallback is deliberately absent here.
 */
export async function POST(request: NextRequest) {
  const wantsStream = request.headers.get("accept")?.includes("text/x-ndjson");
  if (wantsStream) return streamingTranscribe(request);
  return classicTranscribe(request);
}

async function streamingTranscribe(request: NextRequest): Promise<Response> {
  const startedAt = performance.now();
  const requestId = getRequestId(request);
  const spendRef = createSpendReference("hum");
  const encoder = new TextEncoder();

  function emit(controller: ReadableStreamDefaultController, event: TranscribeStreamEvent) {
    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const auth = await resolveRequestAuth(request, {
          allowGuestPreview: shouldAllowGuestTranscribePreview(request),
        });
        if (!auth.ok) {
          emit(controller, { phase: "error", error: "unauthorized", message: "Authentication required", status: 401, requestId });
          controller.close();
          return;
        }
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
          options: TRANSCRIBE_RATE_LIMIT,
        });
        if (!rateLimit.allowed) {
          emit(controller, { phase: "error", error: "rate_limited", message: "Too many requests", status: 429, requestId });
          controller.close();
          return;
        }

        const formData = await request.formData();
        const audio = formData.get("audio");
        const targetInstrumentRaw = formData.get("targetInstrument");
        const targetInstrument =
          typeof targetInstrumentRaw === "string" && targetInstrumentRaw.trim()
            ? targetInstrumentRaw.trim()
            : "piano";

        if (!(audio instanceof File) || audio.size === 0) {
          emit(controller, { phase: "error", error: "audio_required", message: "Audio file is required", status: 400, requestId });
          controller.close();
          return;
        }
        if (audio.size > MAX_AUDIO_BYTES) {
          emit(controller, { phase: "error", error: "audio_too_large", message: "Audio file must be 2 MB or smaller", status: 413, requestId });
          controller.close();
          return;
        }
        if (!isInstrumentId(targetInstrument) || !isMelodyCarrier(targetInstrument)) {
          emit(controller, { phase: "error", error: "validation_error", message: "targetInstrument must be a valid melody instrument", status: 400, requestId });
          controller.close();
          return;
        }

        const billingResult = await resolveBilling(request, auth, userId, requestId, startedAt, spendRef, targetInstrument);
        if (!billingResult.ok) {
          emit(controller, { phase: "error", error: billingResult.errorCode, message: billingResult.message, status: billingResult.status, requestId, currentBalance: billingResult.currentBalance });
          controller.close();
          return;
        }

        emit(controller, { phase: "billing_ok", balanceBefore: billingResult.balanceBefore });

        log("transcribe.requested", {
          bytes: audio.size,
          format: audio.type || "unknown",
          targetInstrument,
          cost: COST.hum,
          balanceBefore: billingResult.balanceBefore,
          billingMode: billingResult.billingMode,
          streaming: true,
        }, {
          route: ROUTE,
          requestId,
          userId,
          sessionId: auth.sessionId,
        });

        emit(controller, { phase: "worker_started" });

        let result: Awaited<ReturnType<typeof transcribeWithAudioWorker>>;
        try {
          result = await transcribeWithAudioWorker({
            audio,
            targetInstrument,
            requestId,
          });
        } catch (error) {
          await refundSpendIfNeeded({
            spend: billingResult.spend,
            requestId,
            userId,
            sessionId: auth.sessionId,
            targetInstrument,
          });
          throw error;
        }

        const totalDurationMs = Math.round(performance.now() - startedAt);
        const budget = checkBudget("transcribe", totalDurationMs);
        log("transcribe.completed", {
          provider: result.provider,
          noteCount: result.cleanMelody.notes.length,
          rawNoteCount: result.rawNotes.length,
          warningCount: result.warnings.length,
          targetInstrument,
          cost: COST.hum,
          balanceAfter: billingResult.spend.ok ? billingResult.spend.balanceAfter : null,
          billingMode: billingResult.billingMode,
          budget_exceeded: budget.budget_exceeded,
          budget_p95: budget.budget_p95,
          streaming: true,
        }, {
          route: ROUTE,
          requestId,
          userId,
          sessionId: auth.sessionId,
          durationMs: totalDurationMs,
        });

        emit(controller, { phase: "complete", result });
        controller.close();
      } catch (error) {
        const classified = classifyError(error);
        if (error instanceof AudioWorkerError) {
          emit(controller, { phase: "error", error: error.code, message: error.message, status: error.status, requestId });
        } else {
          log("transcribe.failed", {
            error_code: "server_error",
            phase: "route",
            message: error instanceof Error ? error.message : String(error),
            error_class: classified.class,
          }, {
            route: ROUTE,
            requestId,
            durationMs: Math.round(performance.now() - startedAt),
            level: "error",
          });
          emit(controller, { phase: "error", error: "server_error", message: "Transcription failed", status: 500, requestId });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/x-ndjson; charset=utf-8",
      "X-Request-Id": requestId,
      "Cache-Control": "no-cache",
    },
  });
}

type BillingOk = {
  ok: true;
  billingMode: BillingMode;
  balanceBefore: number | null;
  spend: Awaited<ReturnType<typeof spendNotes>> | {
    ok: true;
    ledgerId: null;
    balanceBefore: null;
    balanceAfter: null;
    duplicate: false;
  };
};

type BillingFailed = {
  ok: false;
  errorCode: TranscribeRouteError;
  message: string;
  status: number;
  currentBalance?: number | null;
};

type OkAuth = Extract<ResolvedRequestAuth, { ok: true }>;

async function resolveBilling(
  request: NextRequest,
  auth: OkAuth,
  userId: string,
  requestId: string,
  startedAt: number,
  spendRef: string,
  targetInstrument: string,
): Promise<BillingOk | BillingFailed> {
  let balance: Awaited<ReturnType<typeof getNotesBalance>>;
  let billingMode: BillingMode = "ledger";

  if (shouldSkipNotesBilling(auth)) {
    billingMode = "dev_fallback";
    balance = devFallbackBalance(userId);
  } else {
    try {
      balance = await getNotesBalance(userId);
    } catch (error) {
      if (shouldBypassBillingForLocalDemo(request)) {
        billingMode = "dev_fallback";
        balance = devFallbackBalance(userId);
      } else {
        return { ok: false, errorCode: "billing_unavailable", message: "User balance is unavailable", status: 503 };
      }
    }

    if (!balance.ok) {
      if (shouldBypassBillingForLocalDemo(request)) {
        billingMode = "dev_fallback";
        balance = devFallbackBalance(userId);
      } else {
        return { ok: false, errorCode: "billing_unavailable", message: "User balance is unavailable", status: 503 };
      }
    }
    if (
      billingMode === "ledger"
      && auth.user.accountKind !== "local_creator"
      && shouldBypassBillingForLocalDemo(request)
    ) {
      billingMode = "dev_fallback";
      balance = devFallbackBalance(userId);
    }
  }
  if (balance.notes < COST.hum) {
    return { ok: false, errorCode: "insufficient_notes", message: "Not enough Murmur Notes", status: 402, currentBalance: balance.notes };
  }

  let spend: BillingOk["spend"];
  if (billingMode === "dev_fallback") {
    spend = { ok: true, ledgerId: null, balanceBefore: null, balanceAfter: null, duplicate: false };
  } else {
    try {
      const spendResult = await spendNotes({
        userId,
        cost: COST.hum,
        reason: "spend:hum",
        externalRef: spendRef,
        metadata: { requestId, route: ROUTE, phase: "preflight", targetInstrument },
      });
      if (!spendResult.ok) {
        return { ok: false, errorCode: "insufficient_notes", message: "Not enough Murmur Notes", status: 402, currentBalance: spendResult.currentBalance };
      }
      spend = spendResult;
    } catch {
      return { ok: false, errorCode: "billing_unavailable", message: "Could not spend Murmur Notes", status: 503 };
    }
  }

  return {
    ok: true,
    billingMode,
    balanceBefore: Number.isFinite(balance.notes) ? balance.notes : null,
    spend,
  };
}

function devFallbackBalance(userId: string) {
  return {
    ok: true as const,
    userId,
    notes: Number.POSITIVE_INFINITY,
    accountNotes: Number.POSITIVE_INFINITY,
    dailyFreeNotes: 0,
    planTier: "free" as const,
    freeNotesGrantedAt: new Date(),
  };
}

async function classicTranscribe(request: NextRequest) {
  const startedAt = performance.now();
  const requestId = getRequestId(request);
  const spendRef = createSpendReference("hum");
  const auth = await resolveRequestAuth(request, {
    allowGuestPreview: shouldAllowGuestTranscribePreview(request),
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
    options: TRANSCRIBE_RATE_LIMIT,
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
        phase: "validate",
      });
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      return fail("audio_too_large", "Audio file must be 2 MB or smaller", 413, {
        requestId,
        userId,
        startedAt,
        phase: "validate",
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
          phase: "validate",
          ext: { targetInstrument },
        },
      );
    }

    let balance: Awaited<ReturnType<typeof getNotesBalance>>;
    let billingMode: BillingMode = "ledger";
    if (shouldSkipNotesBilling(auth)) {
      billingMode = "dev_fallback";
      balance = {
        ok: true,
        userId,
        notes: Number.POSITIVE_INFINITY,
        accountNotes: Number.POSITIVE_INFINITY,
        dailyFreeNotes: 0,
        planTier: "free",
        freeNotesGrantedAt: new Date(),
      };
    } else {
      try {
        balance = await getNotesBalance(userId);
      } catch (error) {
        if (shouldBypassBillingForLocalDemo(request)) {
          billingMode = "dev_fallback";
          log("user.balance_failed", {
            phase: "billing",
            message: error instanceof Error ? error.message : String(error),
            fallback: "local_demo_bypass",
          }, {
            route: ROUTE,
            requestId,
            userId,
            sessionId: auth.sessionId,
            level: "warn",
          });
          balance = {
            ok: true,
            userId,
            notes: Number.POSITIVE_INFINITY,
            accountNotes: Number.POSITIVE_INFINITY,
            dailyFreeNotes: 0,
            planTier: "free",
            freeNotesGrantedAt: new Date(),
          };
        } else {
          return fail("billing_unavailable", "User balance is unavailable", 503, {
            requestId,
            userId,
            startedAt,
            phase: "billing",
            ext: { message: error instanceof Error ? error.message : String(error) },
          });
        }
      }

      if (!balance.ok) {
        if (shouldBypassBillingForLocalDemo(request)) {
          billingMode = "dev_fallback";
          log("user.balance_failed", {
            phase: "billing",
            reason: balance.reason,
            fallback: "local_demo_bypass",
          }, {
            route: ROUTE,
            requestId,
            userId,
            sessionId: auth.sessionId,
            level: "warn",
          });
          balance = {
            ok: true,
            userId,
            notes: Number.POSITIVE_INFINITY,
            accountNotes: Number.POSITIVE_INFINITY,
            dailyFreeNotes: 0,
            planTier: "free",
            freeNotesGrantedAt: new Date(),
          };
        } else {
          return fail("billing_unavailable", "User balance is unavailable", 503, {
            requestId,
            userId,
            startedAt,
            phase: "billing",
          });
        }
      }
      if (
        billingMode === "ledger"
        && auth.user.accountKind !== "local_creator"
        && shouldBypassBillingForLocalDemo(request)
      ) {
        billingMode = "dev_fallback";
        balance = {
          ok: true,
          userId,
          notes: Number.POSITIVE_INFINITY,
          accountNotes: Number.POSITIVE_INFINITY,
          dailyFreeNotes: 0,
          planTier: "free",
          freeNotesGrantedAt: new Date(),
        };
      }
    }
    if (balance.notes < COST.hum) {
      return fail("insufficient_notes", "Not enough Murmur Notes", 402, {
        requestId,
        userId,
        startedAt,
        phase: "billing",
        ext: { currentBalance: balance.notes, cost: COST.hum },
        body: { currentBalance: balance.notes, cost: COST.hum },
      });
    }

    log("transcribe.requested", {
      bytes: audio.size,
      format: audio.type || "unknown",
      targetInstrument,
      cost: COST.hum,
      balanceBefore: Number.isFinite(balance.notes) ? balance.notes : null,
      billingMode,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
    });

    let spend:
      | Awaited<ReturnType<typeof spendNotes>>
      | {
          ok: true;
          ledgerId: null;
          balanceBefore: null;
          balanceAfter: null;
          duplicate: false;
        };
    if (billingMode === "dev_fallback") {
      spend = {
        ok: true,
        ledgerId: null,
        balanceBefore: null,
        balanceAfter: null,
        duplicate: false,
      };
    } else {
      try {
        spend = await spendNotes({
          userId,
          cost: COST.hum,
          reason: "spend:hum",
          externalRef: spendRef,
          metadata: {
            requestId,
            route: ROUTE,
            phase: "preflight",
            targetInstrument,
          },
        });
      } catch (error) {
        return fail("billing_unavailable", "Could not spend Murmur Notes", 503, {
          requestId,
          userId,
          startedAt,
          phase: "billing",
          ext: { message: error instanceof Error ? error.message : String(error) },
        });
      }

      if (!spend.ok) {
        return fail("insufficient_notes", "Not enough Murmur Notes", 402, {
          requestId,
          userId,
          startedAt,
          phase: "billing",
          ext: { currentBalance: spend.currentBalance, cost: COST.hum },
          body: { currentBalance: spend.currentBalance, cost: COST.hum },
        });
      }

      if (!spend.duplicate) {
        log("notes.spent", {
          reason: "spend:hum",
          cost: COST.hum,
          balanceAfter: spend.balanceAfter,
          ledgerId: spend.ledgerId,
        }, {
          route: ROUTE,
          requestId,
          userId,
          sessionId: auth.sessionId,
        });
      }
    }

    let result: Awaited<ReturnType<typeof transcribeWithAudioWorker>>;
    try {
      result = await transcribeWithAudioWorker({
        audio,
        targetInstrument,
        requestId,
      });
    } catch (error) {
      await refundSpendIfNeeded({
        spend,
        requestId,
        userId,
        sessionId: auth.sessionId,
        targetInstrument,
      });
      throw error;
    }

    const totalDurationMs = Math.round(performance.now() - startedAt);
    const budget = checkBudget("transcribe", totalDurationMs);
    log("transcribe.completed", {
      provider: result.provider,
      noteCount: result.cleanMelody.notes.length,
      rawNoteCount: result.rawNotes.length,
      warningCount: result.warnings.length,
      denoiseMs: result.diagnostics?.denoiseMs ?? null,
      pitchMs: result.diagnostics?.pitchMs ?? null,
      polishMs: result.diagnostics?.polishMs ?? null,
      snr: result.diagnostics?.snr ?? null,
      voicedRatio: result.diagnostics?.voicedRatio ?? null,
      acceptanceScore: result.diagnostics?.acceptanceScore ?? null,
      musicFeelScore: result.diagnostics?.musicFeelScore ?? null,
      noteHypothesis: result.diagnostics?.noteHypothesis ?? null,
      targetInstrument,
      rangeClampApplied: result.diagnostics?.rangeClampApplied ?? false,
      cost: COST.hum,
      balanceAfter: spend.balanceAfter,
      billingMode,
      budget_exceeded: budget.budget_exceeded,
      budget_p95: budget.budget_p95,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      durationMs: totalDurationMs,
    });

    return NextResponse.json(result, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (error) {
    const classified = classifyError(error);
    if (error instanceof AudioWorkerError) {
      return fail(error.code, error.message, error.status, {
        requestId,
        userId,
        startedAt,
        phase: "worker",
        ext: { error_class: classified.class },
      });
    }

    return fail("server_error", "Transcription failed", 500, {
      requestId,
      userId,
      startedAt,
      phase: "route",
      ext: { message: error instanceof Error ? error.message : String(error), error_class: classified.class },
    });
  }
}

function shouldBypassBillingForLocalDemo(request: NextRequest): boolean {
  const host =
    request.nextUrl?.hostname ||
    safeHostnameFromUrl(request.url);
  return shouldBypassBillingInDevelopment({
    host,
  });
}

function shouldAllowGuestTranscribePreview(request: NextRequest): boolean {
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

async function refundSpendIfNeeded(options: {
  spend:
    | Awaited<ReturnType<typeof spendNotes>>
    | {
        ok: true;
        ledgerId: null;
        balanceBefore: null;
        balanceAfter: null;
        duplicate: false;
      };
  requestId: string;
  userId: string;
  sessionId: string | null;
  targetInstrument: string;
}): Promise<void> {
  if (!options.spend.ok) return;
  if (options.spend.ledgerId === null || options.spend.duplicate) return;

  try {
    const refund = await refundNotes({
      originalLedgerId: options.spend.ledgerId,
      metadata: {
        requestId: options.requestId,
        targetInstrument: options.targetInstrument,
        trigger: "transcribe_worker_failed",
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
      return;
    }

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

function fail(
  error: TranscribeRouteError,
  message: string,
  status: number,
  options: {
    requestId: string;
    userId: string;
    startedAt: number;
    phase: "validate" | "billing" | "worker" | "route";
    body?: Record<string, unknown>;
    ext?: Record<string, unknown>;
  },
) {
  log("transcribe.failed", {
    error_code: error,
    phase: options.phase,
    ...options.ext,
  }, {
    route: ROUTE,
    requestId: options.requestId,
    userId: options.userId,
    durationMs: Math.round(performance.now() - options.startedAt),
    level: status >= 500 ? "error" : "warn",
  });

  return NextResponse.json(
    {
      error,
      message,
      requestId: options.requestId,
      ...options.body,
    },
    {
      status,
      headers: { "X-Request-Id": options.requestId },
    },
  );
}

function getRequestId(request: NextRequest): string {
  return request.headers.get("x-request-id") || crypto.randomUUID();
}

function createSpendReference(kind: "hum"): string {
  return `${kind}:${crypto.randomUUID()}`;
}
