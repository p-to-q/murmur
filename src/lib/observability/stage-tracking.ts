import { log } from "./log";

/**
 * Funnel stages for drop-off analysis.
 *
 * The conversion funnel is: hum → vibe → studio → save → gallery.
 * Each transition is a log event with the source and destination stage,
 * so dashboards can compute drop-off rates per step.
 */
export type FunnelStage = "hum" | "vibe" | "studio" | "save" | "gallery";

const STAGE_ORDER: FunnelStage[] = ["hum", "vibe", "studio", "save", "gallery"];

let lastStage: FunnelStage | null = null;
let lastStageEnteredAt: number | null = null;

export function trackStageEntered(
  stage: FunnelStage,
  context?: { flowId?: string; draftId?: string },
): void {
  const now = performance.now();
  const fromStage = lastStage;
  const dwellMs = lastStageEnteredAt !== null
    ? Math.round(now - lastStageEnteredAt)
    : null;

  if (fromStage && STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(fromStage)) {
    log("stage.dropped", {
      from: fromStage,
      to: stage,
      dwellMs,
      ...context,
    });
  }

  log("stage.entered", {
    stage,
    from: fromStage,
    dwellMs,
    ...context,
  });

  lastStage = stage;
  lastStageEnteredAt = now;
}

export function trackStageCompleted(
  stage: FunnelStage,
  context?: Record<string, unknown>,
): void {
  const dwellMs = lastStageEnteredAt !== null
    ? Math.round(performance.now() - lastStageEnteredAt)
    : null;

  log("stage.completed", {
    stage,
    dwellMs,
    ...context,
  });
}

export function resetStageTracking(): void {
  lastStage = null;
  lastStageEnteredAt = null;
}
