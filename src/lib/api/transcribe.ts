import type { TranscribeStreamEvent } from "@/app/api/transcribe/route";
import type { CleanMelody, TranscriptionResult } from "@/modules/shared/types";
import { log } from "@/lib/observability/log";
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
  | "unauthorized"
  | "audio_required"
  | "audio_too_large"
  | "validation_error"
  | "insufficient_notes"
  | "rate_limited"
  | "no_voiced_frames"
  | "worker_unconfigured"
  | "billing_unavailable"
  // The hum failed but the note refund could not complete in-request; a durable
  // marker was written and reconcile will restore the note (#232). Distinct
  // from a generic failure so the UI can reassure the user the note is coming
  // back rather than implying it was consumed for nothing.
  | "refund_pending"
  | "worker_unavailable"
  | "server_error"
  | "network_error";

const SERVER_ERROR_TO_CLIENT: Record<string, TranscribeRequestErrorCode> = {
  unauthorized: "unauthorized",
  session_unavailable: "unauthorized",
  audio_required: "audio_required",
  audio_too_large: "audio_too_large",
  validation_error: "validation_error",
  insufficient_notes: "insufficient_notes",
  rate_limited: "rate_limited",
  no_voiced_frames: "no_voiced_frames",
  worker_unconfigured: "worker_unconfigured",
  worker_http_error: "worker_unavailable",
  worker_invalid_response: "worker_unavailable",
  billing_unavailable: "billing_unavailable",
  refund_pending: "refund_pending",
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
    // Must outlive the server side end to end: the route holds a 40s worker
    // retry budget under its 60s maxDuration (audio-worker.ts), and a success
    // on the 2nd/3rd attempt can land after 40s. Aborting earlier throws away
    // a transcription the user already paid a note for.
    response = await request("/api/transcribe", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(55_000),
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
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "insufficient_notes";
  if (status === 422) return "no_voiced_frames";
  if (status === 429) return "rate_limited";
  if (status === 413) return "audio_too_large";
  if (status >= 500) return "worker_unavailable";
  return "server_error";
}

export type TranscribePhase = "billing_ok" | "worker_started" | "interim_melody" | "complete";
export type TranscribeProgressCallback = (phase: TranscribePhase, data?: unknown) => void;

/**
 * Streaming variant of `transcribeRecording`. Sends `Accept: text/x-ndjson`
 * and reads JSON-Lines progress events so the caller can update UI phase
 * indicators as each stage completes. Falls back to the classic JSON
 * response if the server doesn't support streaming.
 */
export async function transcribeRecordingStreaming(
  audioBlob: Blob,
  options: {
    targetInstrument?: string;
    onProgress?: TranscribeProgressCallback;
  } = {},
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
      headers: { Accept: "text/x-ndjson" },
      signal: AbortSignal.timeout(55_000),
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

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/x-ndjson")) {
    if (!response.ok) throw await buildTranscribeError(response);
    return (await response.json()) as TranscriptionResult;
  }

  return consumeTranscribeStream(response, options.onProgress);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const CLEAN_MELODY_SCALES = new Set<CleanMelody["scale"]>([
  "major",
  "minor",
  "pentatonic",
  "dorian",
  "phrygian",
]);
const CLEAN_MELODY_CONTOURS = new Set<CleanMelody["contour"]>([
  "rising",
  "falling",
  "wave",
  "flat",
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseCleanMelody(value: unknown): CleanMelody | null {
  if (!isRecord(value) || !Array.isArray(value.notes) || value.notes.length === 0) {
    return null;
  }
  if (
    typeof value.key !== "string" ||
    !CLEAN_MELODY_SCALES.has(value.scale as CleanMelody["scale"]) ||
    !isFiniteNumber(value.bpm) ||
    !isFiniteNumber(value.duration) ||
    !CLEAN_MELODY_CONTOURS.has(value.contour as CleanMelody["contour"])
  ) {
    return null;
  }
  const notes = value.notes;
  if (
    !notes.every(
      (note) =>
        isRecord(note) &&
        isFiniteNumber(note.pitch) &&
        isFiniteNumber(note.start) &&
        isFiniteNumber(note.duration) &&
        isFiniteNumber(note.velocity) &&
        isFiniteNumber(note.confidence),
    )
  ) {
    return null;
  }
  return {
    notes: notes as CleanMelody["notes"],
    key: value.key,
    scale: value.scale as CleanMelody["scale"],
    bpm: value.bpm,
    duration: value.duration,
    contour: value.contour as CleanMelody["contour"],
  };
}

/**
 * Runtime-validate a parsed NDJSON line against the `TranscribeStreamEvent`
 * contract before dispatching (#224). Returns the typed event, or null when the
 * shape is unrecognized/malformed so the consumer can skip + log it instead of
 * trusting a blind `as` cast that could mis-drive the UI or throw downstream.
 *
 * Hand-written to match this file's existing guard style (`buildTranscribeError`)
 * and keep zod out of the client bundle. Reconstructs only the known fields so
 * unexpected extras never leak through.
 */
function parseStreamEvent(value: unknown): TranscribeStreamEvent | null {
  if (!isRecord(value)) return null;
  switch (value.phase) {
    case "billing_ok": {
      const balanceBefore = value.balanceBefore;
      if (balanceBefore === null || balanceBefore === undefined) {
        return { phase: "billing_ok", balanceBefore: null };
      }
      if (typeof balanceBefore !== "number") return null;
      return { phase: "billing_ok", balanceBefore };
    }
    case "worker_started":
      return { phase: "worker_started" };
    case "interim_melody": {
      const melody = parseCleanMelody(value.melody);
      return melody ? { phase: "interim_melody", melody } : null;
    }
    case "complete":
      if (!("result" in value)) return null;
      return { phase: "complete", result: value.result };
    case "error": {
      if (
        typeof value.error !== "string" ||
        typeof value.message !== "string" ||
        typeof value.status !== "number" ||
        typeof value.requestId !== "string"
      ) {
        return null;
      }
      return {
        phase: "error",
        error: value.error,
        message: value.message,
        status: value.status,
        requestId: value.requestId,
        currentBalance:
          typeof value.currentBalance === "number" ? value.currentBalance : null,
      };
    }
    default:
      return null;
  }
}

/**
 * Invoke the progress callback defensively (#224). A throwing handler must never
 * reject the whole transcription — that error would not be classified as a
 * network error upstream and would skip the client-pitch fallback, turning a
 * cosmetic UI glitch into a hard failure the user already paid a note for.
 */
function dispatchProgress(
  onProgress: TranscribeProgressCallback | undefined,
  phase: TranscribePhase,
  data?: unknown,
): void {
  if (!onProgress) return;
  try {
    onProgress(phase, data);
  } catch (error) {
    log("transcribe.stream_event_invalid", {
      reason: "onprogress_threw",
      phase,
      message: error instanceof Error ? error.message : String(error),
    }, { level: "warn" });
  }
}

async function consumeTranscribeStream(
  response: Response,
  onProgress?: TranscribeProgressCallback,
): Promise<TranscriptionResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new TranscribeRequestError({
      code: "network_error",
      status: 0,
      message: "No response body for streaming transcription",
    });
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let result: TranscriptionResult | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Not JSON (e.g. a proxy error page spliced into the stream). Skip the
        // line rather than failing the whole transcription (#224).
        log("transcribe.stream_event_invalid", {
          reason: "json_parse_failed",
          preview: line.slice(0, 64),
        }, { level: "warn" });
        continue;
      }

      const event = parseStreamEvent(parsed);
      if (!event) {
        // Well-formed JSON but not a recognized event shape. Skip + log instead
        // of dispatching an unvalidated event downstream (#224).
        const receivedPhase = isRecord(parsed) ? parsed.phase : undefined;
        log("transcribe.stream_event_invalid", {
          reason: "schema_mismatch",
          receivedPhase:
            typeof receivedPhase === "string" ? receivedPhase : typeof receivedPhase,
        }, { level: "warn" });
        continue;
      }

      switch (event.phase) {
        case "billing_ok":
        case "worker_started":
          dispatchProgress(onProgress, event.phase);
          break;
        case "interim_melody":
          dispatchProgress(onProgress, event.phase, event.melody);
          break;
        case "complete":
          dispatchProgress(onProgress, "complete");
          result = event.result as TranscriptionResult;
          break;
        case "error": {
          // A server-emitted error event is intentional control flow (not a bad
          // event): surface it as the typed transport error so callers can pick
          // recovery copy. This throw is deliberately not swallowed.
          const mapped = SERVER_ERROR_TO_CLIENT[event.error];
          throw new TranscribeRequestError({
            code: mapped ?? statusToFallbackCode(event.status),
            status: event.status,
            message: event.message,
            requestId: event.requestId,
            currentBalance: event.currentBalance,
          });
        }
      }
    }

    if (done) break;
  }

  if (!result) {
    throw new TranscribeRequestError({
      code: "server_error",
      status: 500,
      message: "Streaming transcription ended without a result",
    });
  }

  return result;
}
