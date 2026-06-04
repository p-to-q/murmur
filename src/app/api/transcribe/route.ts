import { NextRequest, NextResponse } from "next/server";
import {
  AudioWorkerError,
  isInstrumentId,
  isMelodyCarrier,
  transcribeWithAudioWorker,
} from "@/lib/platform/audio-worker";
import { resolveRequestAuth } from "@/lib/auth";
import { getNotesBalance, spendNotes } from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";
import { COST } from "@murmur/core";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const ROUTE = "/api/transcribe";

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

/**
 * POST /api/transcribe
 *
 * Server-authoritative transcription boundary. The browser uploads captured
 * audio; the route validates the request, calls the audio worker, and returns
 * a polished/scored melody. Fixture fallback is deliberately absent here.
 */
export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

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
    try {
      balance = await getNotesBalance(userId);
    } catch (error) {
      return fail("billing_unavailable", "User balance is unavailable", 503, {
        requestId,
        userId,
        startedAt,
        phase: "billing",
        ext: { message: error instanceof Error ? error.message : String(error) },
      });
    }

    if (!balance.ok) {
      return fail("billing_unavailable", "User balance is unavailable", 503, {
        requestId,
        userId,
        startedAt,
        phase: "billing",
      });
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
      balanceBefore: balance.notes,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
    });

    const result = await transcribeWithAudioWorker({
      audio,
      targetInstrument,
      requestId,
    });

    let spend: Awaited<ReturnType<typeof spendNotes>>;
    try {
      spend = await spendNotes({
        userId,
        cost: COST.hum,
        reason: "spend:hum",
        externalRef: requestId,
        metadata: {
          provider: result.provider,
          noteCount: result.cleanMelody.notes.length,
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
      targetInstrument,
      rangeClampApplied: result.diagnostics?.rangeClampApplied ?? false,
      cost: COST.hum,
      balanceAfter: spend.balanceAfter,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return NextResponse.json(result, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (error) {
    if (error instanceof AudioWorkerError) {
      return fail(error.code, error.message, error.status, {
        requestId,
        userId,
        startedAt,
        phase: "worker",
      });
    }

    return fail("server_error", "Transcription failed", 500, {
      requestId,
      userId,
      startedAt,
      phase: "route",
      ext: { message: error instanceof Error ? error.message : String(error) },
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
