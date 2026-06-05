import type { TranscribeRequestErrorCode } from "@/lib/api/transcribe";
import type { FixtureRescueState } from "@/lib/audio/fixture-rescue-policy";

const HARD_FAILURE_CODES = new Set<TranscribeRequestErrorCode | "mic_unavailable">([
  "worker_unconfigured",
  "server_error",
]);

const TRANSIENT_SUPPORT_CODES = new Set<TranscribeRequestErrorCode>([
  "network_error",
  "worker_unavailable",
  "billing_unavailable",
  "rate_limited",
]);

export function shouldShowHumSupportCode(args: {
  code: TranscribeRequestErrorCode | "mic_unavailable";
  state: FixtureRescueState;
}): boolean {
  const { code, state } = args;

  if (HARD_FAILURE_CODES.has(code)) {
    return true;
  }

  if (!TRANSIENT_SUPPORT_CODES.has(code as TranscribeRequestErrorCode)) {
    return false;
  }

  if (state.liveSuccessCount < 1) {
    return true;
  }

  if (state.transientFailureStreak >= 2) {
    return true;
  }

  if (state.totalFailures >= 3) {
    return true;
  }

  return false;
}
