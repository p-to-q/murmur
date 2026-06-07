import type { TranscribeRequestErrorCode } from "@/lib/api/transcribe";

export type FixtureRescueState = {
  liveSuccessCount: number;
  transientFailureStreak: number;
  totalFailures: number;
  rescueCountSinceLiveSuccess: number;
  lastFailureAt: number | null;
};

export const INITIAL_FIXTURE_RESCUE_STATE: FixtureRescueState = {
  liveSuccessCount: 0,
  transientFailureStreak: 0,
  totalFailures: 0,
  rescueCountSinceLiveSuccess: 0,
  lastFailureAt: null,
};

const TRANSIENT_CODES = new Set<TranscribeRequestErrorCode>([
  "network_error",
  "worker_unavailable",
  "worker_unconfigured",  // 添加：当音频引擎未配置时，自动使用示例旋律
  "billing_unavailable",
]);

export function noteLiveSuccess(
  state: FixtureRescueState,
): FixtureRescueState {
  return {
    liveSuccessCount: state.liveSuccessCount + 1,
    transientFailureStreak: 0,
    totalFailures: state.totalFailures,
    rescueCountSinceLiveSuccess: 0,
    lastFailureAt: state.lastFailureAt,
  };
}

export function noteLiveFailure(
  state: FixtureRescueState,
  code: TranscribeRequestErrorCode,
  now = Date.now(),
): FixtureRescueState {
  const transient = TRANSIENT_CODES.has(code);
  return {
    liveSuccessCount: state.liveSuccessCount,
    transientFailureStreak: transient ? state.transientFailureStreak + 1 : 0,
    totalFailures: state.totalFailures + 1,
    rescueCountSinceLiveSuccess: transient
      ? state.rescueCountSinceLiveSuccess
      : 0,
    lastFailureAt: now,
  };
}

export function noteFixtureRescueUsed(
  state: FixtureRescueState,
): FixtureRescueState {
  return {
    ...state,
    rescueCountSinceLiveSuccess: state.rescueCountSinceLiveSuccess + 1,
  };
}

export function shouldAutoRescueWithFixture(args: {
  state: FixtureRescueState;
  code: TranscribeRequestErrorCode;
  now?: number;
}): boolean {
  const now = args.now ?? Date.now();
  const { state, code } = args;

  if (!TRANSIENT_CODES.has(code)) return false;
  if (state.liveSuccessCount < 1) return false;
  if (state.transientFailureStreak >= 2) return false;
  if (state.rescueCountSinceLiveSuccess >= 2) return false;

  if (state.lastFailureAt !== null) {
    const sinceLastFailureMs = now - state.lastFailureAt;
    if (sinceLastFailureMs <= 60_000 && state.transientFailureStreak >= 1) {
      return false;
    }
    if (
      sinceLastFailureMs <= 10 * 60_000 &&
      state.rescueCountSinceLiveSuccess >= 1
    ) {
      return false;
    }
  }

  return true;
}

export function serializeFixtureRescueState(
  state: FixtureRescueState,
): string {
  return JSON.stringify(state);
}

export function parseFixtureRescueState(
  raw: string | null | undefined,
): FixtureRescueState {
  if (!raw) return { ...INITIAL_FIXTURE_RESCUE_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<FixtureRescueState>;
    return {
      liveSuccessCount:
        typeof parsed.liveSuccessCount === "number" && parsed.liveSuccessCount >= 0
          ? parsed.liveSuccessCount
          : 0,
      transientFailureStreak:
        typeof parsed.transientFailureStreak === "number" && parsed.transientFailureStreak >= 0
          ? parsed.transientFailureStreak
          : 0,
      totalFailures:
        typeof parsed.totalFailures === "number" && parsed.totalFailures >= 0
          ? parsed.totalFailures
          : 0,
      rescueCountSinceLiveSuccess:
        typeof parsed.rescueCountSinceLiveSuccess === "number" &&
        parsed.rescueCountSinceLiveSuccess >= 0
          ? parsed.rescueCountSinceLiveSuccess
          : 0,
      lastFailureAt:
        typeof parsed.lastFailureAt === "number" ? parsed.lastFailureAt : null,
    };
  } catch {
    return { ...INITIAL_FIXTURE_RESCUE_STATE };
  }
}
