export type InputLevelState = "idle" | "quiet" | "heard";
export type InputLevelLabelKey =
  | "hum.level.idle"
  | "hum.level.quiet.1"
  | "hum.level.quiet.2"
  | "hum.level.heard";

export interface InputLevelDecision {
  state: InputLevelState;
  quietSinceMs: number | null;
  hasHeardSignal: boolean;
}

export interface InputLevelSample {
  rms: number;
  elapsedMs: number;
  quietSinceMs: number | null;
  hasHeardSignal: boolean;
}

const HEARD_RMS_THRESHOLD = 0.018;
const QUIET_RMS_THRESHOLD = 0.012;
const QUIET_WARMUP_MS = 1800;
const QUIET_CONFIRM_MS = 1400;

export function nextInputLevelDecision({
  rms,
  elapsedMs,
  quietSinceMs,
  hasHeardSignal,
}: InputLevelSample): InputLevelDecision {
  if (rms >= HEARD_RMS_THRESHOLD) {
    return {
      state: "heard",
      quietSinceMs: null,
      hasHeardSignal: true,
    };
  }

  if (rms >= QUIET_RMS_THRESHOLD) {
    return {
      state: hasHeardSignal ? "heard" : "idle",
      quietSinceMs: null,
      hasHeardSignal,
    };
  }

  if (elapsedMs < QUIET_WARMUP_MS) {
    return {
      state: hasHeardSignal ? "heard" : "idle",
      quietSinceMs: null,
      hasHeardSignal,
    };
  }

  const nextQuietSinceMs = quietSinceMs ?? elapsedMs;
  if (elapsedMs - nextQuietSinceMs >= QUIET_CONFIRM_MS) {
    return {
      state: "quiet",
      quietSinceMs: nextQuietSinceMs,
      hasHeardSignal,
    };
  }

  return {
    state: hasHeardSignal ? "heard" : "idle",
    quietSinceMs: nextQuietSinceMs,
    hasHeardSignal,
  };
}

export function inputLevelLabelKey(state: InputLevelState): InputLevelLabelKey {
  switch (state) {
    case "quiet":
      return randomQuietInputLevelLabelKey();
    case "heard":
      return "hum.level.heard";
    case "idle":
      return "hum.level.idle";
  }
}

export function randomQuietInputLevelLabelKey(
  random: () => number = Math.random,
): Extract<InputLevelLabelKey, "hum.level.quiet.1" | "hum.level.quiet.2"> {
  return random() < 0.5 ? "hum.level.quiet.1" : "hum.level.quiet.2";
}
