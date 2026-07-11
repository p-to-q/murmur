import { NextRequest, NextResponse } from "next/server";
import {
  AudioWorkerError,
  isInstrumentId,
  isMelodyCarrier,
  transcribeWithAudioWorker,
} from "@/lib/platform/audio-worker";
import type { CleanMelody } from "@/modules/shared/types";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth, type ResolvedRequestAuth } from "@/lib/auth";
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
import { safeHostnameFromUrl } from "@/lib/http/safe-hostname";
import { classifyError } from "@/lib/errors/transient";
import { log } from "@/lib/observability/log";
import { checkBudget } from "@/lib/observability/latency-budgets";
import { COST } from "@murmur/core";

export type TranscribeStreamEvent =
  | { phase: "billing_ok"; balanceBefore: number | null }
  | { phase: "worker_started" }
  | { phase: "interim_melody"; melody: CleanMelody }
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
  | "refund_pending"
  | "server_error";

type BillingMode = "ledger" | "dev_fallback";

/**
 * Distinct client signal (#232): the worker failed AND the automatic refund
 * could not complete in-request, so a durable `refund:pending` marker was
 * written for the reconcile cron to retry. Surfaced to the client instead of
 * masking the charge behind the worker's own error (previous behaviour).
 */
const REFUND_PENDING_MESSAGE =
  "Transcription failed and your note couldn't be returned right away — it's queued to be restored.";

/** Outcome of the best-effort in-request refund after a worker failure. */
type TranscribeRefundOutcome = "refunded" | "not_needed" | "pending";

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

  // Unified client-disconnect signal (#206). Fed by both the request abort
  // (`request.signal` fires in the Node runtime when the socket drops) and the
  // response stream's `cancel()` (fires when the consumer tears down) so a
  // mid-stream disconnect refunds the spent note no matter which teardown
  // signal the platform delivers first.
  const clientGone = new AbortController();
  const markClientGone = () => clientGone.abort();
  if (request.signal.aborted) {
    markClientGone();
  } else {
    request.signal.addEventListener("abort", markClientGone, { once: true });
  }

  function safeClose(controller: ReadableStreamDefaultController) {
    try {
      controller.close();
    } catch {
      // Stream already torn down by the client disconnect — nothing to close.
    }
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

        // Client already vanished before we spent anything (#206) — bail before
        // billing so there's no note to refund.
        if (clientGone.signal.aborted) {
          safeClose(controller);
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

        // Race the worker call against a client disconnect (#206). On disconnect
        // we stop awaiting the worker and refund the spent note — mirroring the
        // worker-failure refund the classic path performs — instead of silently
        // keeping the charge for a transcription the user will never receive.
        // The underlying worker fetch self-terminates within its own retry
        // budget (audio-worker.ts); we don't hold the request open for it.
        const disconnected = new Promise<{ kind: "disconnected" }>((resolve) => {
          if (clientGone.signal.aborted) {
            resolve({ kind: "disconnected" });
            return;
          }
          clientGone.signal.addEventListener(
            "abort",
            () => resolve({ kind: "disconnected" }),
            { once: true },
          );
        });

        // Fold the worker's settlement into a value (never a rejection) so a
        // disconnect that wins the race can't leave the worker promise rejecting
        // unobserved once we've stopped awaiting it.
        const workerSettled = transcribeWithAudioWorker({
          audio,
          targetInstrument,
          requestId,
          onInterimMelody: (melody) => {
            emit(controller, { phase: "interim_melody", melody });
          },
        }).then(
          (value) => ({ kind: "result" as const, value }),
          (error: unknown) => ({ kind: "error" as const, error }),
        );

        const raced = await Promise.race([workerSettled, disconnected]);

        if (raced.kind === "disconnected") {
          // The three race outcomes are mutually exclusive, so the refund below
          // and the worker-error refund can't both fire for one request; the
          // underlying refund is also idempotent by ledger id, so a late
          // `cancel()` after settlement can never double-credit.
          const outcome = await refundSpendIfNeeded({
            spend: billingResult.spend,
            requestId,
            userId,
            sessionId: auth.sessionId,
            targetInstrument,
          });
          log("transcribe.client_disconnected", {
            targetInstrument,
            billingMode: billingResult.billingMode,
            refund: outcome,
            streaming: true,
          }, {
            route: ROUTE,
            requestId,
            userId,
            sessionId: auth.sessionId,
            durationMs: Math.round(performance.now() - startedAt),
            level: "warn",
          });
          safeClose(controller);
          return;
        }

        if (raced.kind === "error") {
          const outcome = await refundSpendIfNeeded({
            spend: billingResult.spend,
            requestId,
            userId,
            sessionId: auth.sessionId,
            targetInstrument,
          });
          if (outcome === "pending") {
            // Don't mask the charge behind the worker error — tell the client a
            // refund is owed and being restored (#232).
            emit(controller, {
              phase: "error",
              error: "refund_pending",
              message: REFUND_PENDING_MESSAGE,
              status: 500,
              requestId,
            });
            controller.close();
            return;
          }
          throw raced.error;
        }

        const result = raced.value;

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
    cancel() {
      // The consumer (client) went away. Unblock any in-flight worker race so
      // the spent note is refunded via the disconnect branch above (#206).
      markClientGone();
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
    } catch {
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
      const outcome = await refundSpendIfNeeded({
        spend,
        requestId,
        userId,
        sessionId: auth.sessionId,
        targetInstrument,
      });
      if (outcome === "pending") {
        // Refund could not complete in-request; a durable marker was written
        // for reconcile to retry. Surface the distinct signal instead of
        // re-throwing the worker error and masking the lost note (#232).
        return fail("refund_pending", REFUND_PENDING_MESSAGE, 500, {
          requestId,
          userId,
          startedAt,
          phase: "billing",
        });
      }
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
}): Promise<TranscribeRefundOutcome> {
  if (!options.spend.ok) return "not_needed";
  if (options.spend.ledgerId === null || options.spend.duplicate) return "not_needed";
  const ledgerId = options.spend.ledgerId;

  try {
    const refund = await refundNotes({
      originalLedgerId: ledgerId,
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
      return "refunded";
    }

    return recordTranscribeRefundPending({
      ledgerId,
      failureReason: refund.reason,
      requestId: options.requestId,
      userId: options.userId,
      sessionId: options.sessionId,
      targetInstrument: options.targetInstrument,
    });
  } catch (error) {
    return recordTranscribeRefundPending({
      ledgerId,
      failureReason: error instanceof Error ? error.message : String(error),
      requestId: options.requestId,
      userId: options.userId,
      sessionId: options.sessionId,
      targetInstrument: options.targetInstrument,
    });
  }
}

/**
 * In-request refund failed: persist a durable `refund:pending` marker (#232)
 * so reconcile can retry the reversal idempotently, and return "pending" so the
 * route surfaces the distinct signal rather than masking the lost note behind
 * the worker error. A marker-write failure downgrades the log to
 * MANUAL_REFUND_REQUIRED but still reports "pending" — the user is owed a note.
 */
async function recordTranscribeRefundPending(input: {
  ledgerId: string;
  failureReason: string;
  requestId: string;
  userId: string;
  sessionId: string | null;
  targetInstrument: string;
}): Promise<"pending"> {
  let pendingRecorded = false;
  try {
    const pending = await recordPendingRefund({
      userId: input.userId,
      originalLedgerId: input.ledgerId,
      amount: COST.hum,
      spendReason: "spend:hum",
      requestId: input.requestId,
      source: "transcribe_refund_failed",
      metadata: {
        trigger: "transcribe_worker_failed",
        targetInstrument: input.targetInstrument,
        refundError: input.failureReason,
      },
    });
    pendingRecorded = pending.ok;
  } catch (markerError) {
    log("notes.refund_failed", {
      requestLedgerId: input.ledgerId,
      reason: input.failureReason,
      pendingMarkerError: markerError instanceof Error ? markerError.message : String(markerError),
      reconciliation: "MANUAL_REFUND_REQUIRED",
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
