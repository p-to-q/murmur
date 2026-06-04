import type { TranscriptionResult } from "@/modules/shared/types";
import { request } from "./request";

/**
 * Stable client-facing transcribe error codes.
 *
 * These names are the contract HumScreen (and any future shell) reads to
 * decide which copy + recovery affordance to show. The set intentionally
 * collapses 4xx/5xx variants the user does not need to distinguish (e.g.
 * `worker_invalid_response` and `worker_http_error` both become
 * `worker_unavailable`). Keep this list aligned with the page contract
 * in `docs/page-contracts.md` §1 (`TranscribeErrorCode`).
 */
export type TranscribeRequestErrorCode =
  | "audio_required"
  | "audio_too_large"
  | "validation_error"
  | "insufficient_notes"
  | "rate_limited"
  | "no_voiced_frames"
  | "worker_unavailable"
  | "server_error"
  | "network_error";

const SERVER_ERROR_TO_CLIENT: Record<string, TranscribeRequestErrorCode> = {
  audio_required: "audio_required",
  audio_too_large: "audio_too_large",
  validation_error: "validation_error",
  insufficient_notes: "insufficient_notes",
  rate_limited: "rate_limited",
  no_voiced_frames: "no_voiced_frames",
  worker_unconfigured: "worker_unavailable",
  worker_http_error: "worker_unavailable",
  worker_invalid_response: "worker_unavailable",
  billing_unavailable: "worker_unavailable",
  server_error: "server_error",
};

/**
 * Typed transport error thrown by `transcribeRecording`. Callers switch
 * on `.code` to pick recovery copy; `.message` is for diagnostics only.
 */
export class TranscribeRequestError extends Error {
  readonly code: TranscribeRequestErrorCode;
  readonly status: number;
  readonly requestId: string | null;
  readonly currentBalance: number | null;

  constructor(init: {
    code: TranscribeRequestErrorCode;
    message: string;
    status: number;
    requestId?: string | null;
    currentBalance?: number | null;
  }) {
    super(init.message);
    this.name = "TranscribeRequestError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.currentBalance = init.currentBalance ?? null;
  }
}

/**
 * Send a recorded hum to Murmur's server-authoritative transcription
 * route. Real recordings never fall back to fixture on the client;
 * callers should surface the typed error and offer an explicit demo
 * action instead.
 */
export async function transcribeRecording(
  audioBlob: Blob,
  options: { targetInstrument?: string } = {},
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("audio", audioBlob, filenameForBlob(audioBlob));
  if (options.targetInstrument) {
    form.append("targetInstrument", options.targetInstrument);
  }

  let response: Response;
  try {
    response = await request("/api/transcribe", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(35_000),
    });
  } catch (cause) {
    throw new TranscribeRequestError({
      code: "network_error",
      status: 0,
      message:
        cause instanceof Error
          ? `Transcription request failed: ${cause.message}`
          : "Transcription request failed",
    });
  }

  if (!response.ok) {
    throw await buildTranscribeError(response);
  }

  return (await response.json()) as TranscriptionResult;
}

function filenameForBlob(blob: Blob): string {
  if (blob.type.includes("webm")) return "hum.webm";
  if (blob.type.includes("mp4") || blob.type.includes("m4a")) return "hum.m4a";
  if (blob.type.includes("mpeg") || blob.type.includes("mp3")) return "hum.mp3";
  if (blob.type.includes("wav")) return "hum.wav";
  return "hum.audio";
}

async function buildTranscribeError(
  response: Response,
): Promise<TranscribeRequestError> {
  const status = response.status;
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // Body wasn't JSON; fall through to the status-derived code below.
  }

  const serverErrorRaw =
    typeof payload.error === "string" ? payload.error : null;
  const messageRaw =
    typeof payload.message === "string" ? payload.message : null;
  const requestIdRaw =
    typeof payload.requestId === "string" ? payload.requestId : null;
  const currentBalanceRaw =
    typeof payload.currentBalance === "number" ? payload.currentBalance : null;

  const mapped = serverErrorRaw
    ? SERVER_ERROR_TO_CLIENT[serverErrorRaw]
    : undefined;
  const code: TranscribeRequestErrorCode = mapped ?? statusToFallbackCode(status);

  return new TranscribeRequestError({
    code,
    status,
    message:
      messageRaw ?? serverErrorRaw ?? `Transcription failed with HTTP ${status}`,
    requestId: requestIdRaw,
    currentBalance: currentBalanceRaw,
  });
}

function statusToFallbackCode(status: number): TranscribeRequestErrorCode {
  if (status === 402) return "insufficient_notes";
  if (status === 422) return "no_voiced_frames";
  if (status === 429) return "rate_limited";
  if (status === 413) return "audio_too_large";
  if (status >= 500) return "worker_unavailable";
  return "server_error";
}
