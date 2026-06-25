import type { TranscriptionResult } from "@/modules/shared/types";
import type { SpeechLanguage, VoiceRouteDiagnostics } from "@/lib/platform/speech-recognition";
import type { TranscribeRequestErrorCode } from "./transcribe";
import { request } from "./request";

export type CaptureAnalyzeResult =
  | { kind: "hum"; transcription: TranscriptionResult }
  | {
      kind: "voice";
      lyrics: string;
      language: SpeechLanguage;
      confidence: number;
      diagnostics: VoiceRouteDiagnostics;
    };

export class CaptureAnalyzeError extends Error {
  readonly code: TranscribeRequestErrorCode;
  readonly status: number;
  readonly requestId: string | null;
  readonly currentBalance: number | null;

  constructor(input: {
    code: TranscribeRequestErrorCode;
    message: string;
    status: number;
    requestId?: string | null;
    currentBalance?: number | null;
  }) {
    super(input.message);
    this.name = "CaptureAnalyzeError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId ?? null;
    this.currentBalance = input.currentBalance ?? null;
  }
}

export async function analyzeRecording(
  audioBlob: Blob,
  options: { targetInstrument?: string } = {},
): Promise<CaptureAnalyzeResult> {
  const form = new FormData();
  form.append("audio", audioBlob, filenameForBlob(audioBlob));
  if (options.targetInstrument) {
    form.append("targetInstrument", options.targetInstrument);
  }

  const response = await request("/api/capture/analyze", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(90_000),
  }).catch((error) => {
    throw new CaptureAnalyzeError(
      {
        code: "network_error",
        message: error instanceof Error ? error.message : "Capture analysis failed",
        status: 0,
      },
    );
  });

  if (!response.ok) {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      // non-JSON body
    }
    throw new CaptureAnalyzeError(
      {
        code: captureErrorCode(payload.error, response.status),
        message: typeof payload.message === "string"
          ? payload.message
          : `Capture analysis failed with HTTP ${response.status}`,
        status: response.status,
        requestId: typeof payload.requestId === "string" ? payload.requestId : null,
        currentBalance: typeof payload.currentBalance === "number" ? payload.currentBalance : null,
      },
    );
  }

  return (await response.json()) as CaptureAnalyzeResult;
}

function captureErrorCode(error: unknown, status: number): TranscribeRequestErrorCode {
  switch (error) {
    case "unauthorized":
    case "session_unavailable":
      return "unauthorized";
    case "audio_required":
      return "audio_required";
    case "audio_too_large":
      return "audio_too_large";
    case "validation_error":
      return "validation_error";
    case "insufficient_notes":
      return "insufficient_notes";
    case "rate_limited":
      return "rate_limited";
    case "no_voiced_frames":
      return "no_voiced_frames";
    case "worker_unconfigured":
      return "worker_unconfigured";
    case "worker_http_error":
    case "worker_invalid_response":
      return "worker_unavailable";
    case "billing_unavailable":
      return "billing_unavailable";
    case "server_error":
      return "server_error";
    default:
      return statusToCaptureFallbackCode(status);
  }
}

function statusToCaptureFallbackCode(status: number): TranscribeRequestErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "insufficient_notes";
  if (status === 422) return "no_voiced_frames";
  if (status === 429) return "rate_limited";
  if (status === 413) return "audio_too_large";
  if (status >= 500) return "worker_unavailable";
  return "server_error";
}

function filenameForBlob(blob: Blob): string {
  if (blob.type.includes("webm")) return "capture.webm";
  if (blob.type.includes("mp4") || blob.type.includes("m4a")) return "capture.m4a";
  if (blob.type.includes("mpeg") || blob.type.includes("mp3")) return "capture.mp3";
  if (blob.type.includes("wav")) return "capture.wav";
  return "capture.audio";
}
