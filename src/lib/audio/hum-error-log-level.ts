import type { TranscribeRequestErrorCode } from "@/lib/api/transcribe";

export type HumLogLevel = "warn" | "error";

const HANDLED_WARN_CODES = new Set<TranscribeRequestErrorCode>([
  "unauthorized",
  "network_error",
  "worker_unavailable",
  "billing_unavailable",
  "rate_limited",
  "no_voiced_frames",
  "insufficient_notes",
  "audio_too_large",
  "validation_error",
  "audio_required",
  "worker_unconfigured",
]);

export function humErrorLogLevel(
  code: TranscribeRequestErrorCode,
): HumLogLevel {
  return HANDLED_WARN_CODES.has(code) ? "warn" : "error";
}
