export const HUM_RECORDING_LIMIT_MS = 15_000;
export const HUM_RECORDING_LIMIT_SECONDS = HUM_RECORDING_LIMIT_MS / 1000;

export function clampRecordingElapsedMs(
  elapsedMs: number,
  limitMs = HUM_RECORDING_LIMIT_MS,
): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  return Math.min(Math.max(elapsedMs, 0), limitMs);
}

export function recordingProgressFromElapsed(
  elapsedMs: number,
  limitMs = HUM_RECORDING_LIMIT_MS,
): number {
  if (!Number.isFinite(limitMs) || limitMs <= 0) return 0;
  return clampRecordingElapsedMs(elapsedMs, limitMs) / limitMs;
}

export function formatRecordingElapsedSeconds(
  elapsedMs: number,
  limitMs = HUM_RECORDING_LIMIT_MS,
): string {
  const seconds = clampRecordingElapsedMs(elapsedMs, limitMs) / 1000;
  return seconds.toFixed(1).padStart(4, "0");
}
