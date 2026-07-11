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

export const STAGE_TRACKING_MAX_RETAINED_FLOWS = 100;

type FlowStageState = {
  lastStage: FunnelStage;
  lastStageEnteredAt: number;
};

const flowStates = new Map<string, FlowStageState>();

function retainFlowState(flowId: string, state: FlowStageState): void {
  flowStates.delete(flowId);
  flowStates.set(flowId, state);

  while (flowStates.size > STAGE_TRACKING_MAX_RETAINED_FLOWS) {
    const oldestFlowId = flowStates.keys().next().value;
    if (oldestFlowId === undefined) break;
    flowStates.delete(oldestFlowId);
  }
}

export function trackStageEntered(
  flowId: string,
  stage: FunnelStage,
  context?: { draftId?: string },
): void {
  const now = performance.now();
  const previous = flowStates.get(flowId);
  const fromStage = previous?.lastStage ?? null;
  const dwellMs = previous
    ? Math.round(now - previous.lastStageEnteredAt)
    : null;

  if (fromStage && STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(fromStage)) {
    log("stage.dropped", {
      ...context,
      from: fromStage,
      to: stage,
      dwellMs,
      flowId,
    });
  }

  log("stage.entered", {
    ...context,
    stage,
    from: fromStage,
    dwellMs,
    flowId,
  });

  retainFlowState(flowId, { lastStage: stage, lastStageEnteredAt: now });
}

export function trackStageCompleted(
  flowId: string,
  stage: FunnelStage,
  context?: Record<string, unknown>,
): void {
  const state = flowStates.get(flowId);
  const dwellMs = state
    ? Math.round(performance.now() - state.lastStageEnteredAt)
    : null;

  log("stage.completed", {
    ...context,
    stage,
    dwellMs,
    flowId,
  });

  if (state) retainFlowState(flowId, state);
}

export function resetStageTracking(flowId: string): void {
  flowStates.delete(flowId);
}
