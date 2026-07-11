import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  resetStageTracking,
  STAGE_TRACKING_MAX_RETAINED_FLOWS,
  trackStageCompleted,
  trackStageEntered,
  type FunnelStage,
} from "./stage-tracking";

type LoggedLine = {
  msg: string;
  level: string;
  ext: Record<string, unknown>;
};

// `log` emits one JSON line per event via console.info/warn/error. Capturing
// the console keeps these tests aligned with the real transport instead of
// mocking module internals.
let lines: LoggedLine[] = [];
let infoSpy: ReturnType<typeof spyOn> | null = null;
const trackedFlowIds = new Set<string>();

function captured(msg: string): LoggedLine[] {
  return lines.filter((line) => line.msg === msg);
}

function enter(
  flowId: string,
  stage: FunnelStage,
  context?: { draftId?: string },
): void {
  trackedFlowIds.add(flowId);
  trackStageEntered(flowId, stage, context);
}

function complete(
  flowId: string,
  stage: FunnelStage,
  context?: Record<string, unknown>,
): void {
  trackedFlowIds.add(flowId);
  trackStageCompleted(flowId, stage, context);
}

beforeEach(() => {
  lines = [];
  infoSpy = spyOn(console, "info").mockImplementation((raw: unknown) => {
    if (typeof raw !== "string") return;
    try {
      lines.push(JSON.parse(raw) as LoggedLine);
    } catch {
      // not a structured log line — ignore
    }
  });
});

afterEach(() => {
  infoSpy?.mockRestore();
  for (const flowId of trackedFlowIds) resetStageTracking(flowId);
  trackedFlowIds.clear();
});

describe("trackStageEntered", () => {
  it("emits stage.entered with null origin on the first stage", () => {
    enter("flow_1", "hum");

    const entered = captured("stage.entered");
    expect(entered).toHaveLength(1);
    expect(entered[0]!.ext.stage).toBe("hum");
    expect(entered[0]!.ext.from).toBeNull();
    expect(entered[0]!.ext.dwellMs).toBeNull();
    expect(entered[0]!.ext.flowId).toBe("flow_1");
    expect(captured("stage.dropped")).toHaveLength(0);
  });

  it("chains forward transitions with origin and dwell", () => {
    enter("flow_1", "hum");
    enter("flow_1", "vibe", { draftId: "draft_1" });

    const entered = captured("stage.entered");
    expect(entered).toHaveLength(2);
    expect(entered[1]!.ext.stage).toBe("vibe");
    expect(entered[1]!.ext.from).toBe("hum");
    expect(typeof entered[1]!.ext.dwellMs).toBe("number");
    expect(entered[1]!.ext.flowId).toBe("flow_1");
    expect(entered[1]!.ext.draftId).toBe("draft_1");
    expect(captured("stage.dropped")).toHaveLength(0);
  });

  it("keeps interleaved flow origins and dwell state isolated", () => {
    enter("flow_a", "hum");
    enter("flow_b", "hum");
    enter("flow_a", "vibe", { draftId: "draft_a" });
    enter("flow_b", "studio", { draftId: "draft_b" });

    const entered = captured("stage.entered");
    expect(entered[2]!.ext.flowId).toBe("flow_a");
    expect(entered[2]!.ext.from).toBe("hum");
    expect(entered[2]!.ext.draftId).toBe("draft_a");
    expect(entered[3]!.ext.flowId).toBe("flow_b");
    expect(entered[3]!.ext.from).toBe("hum");
    expect(entered[3]!.ext.draftId).toBe("draft_b");
    expect(captured("stage.dropped")).toHaveLength(0);
  });

  it("emits stage.dropped when moving backwards in the same flow", () => {
    enter("flow_1", "studio");
    enter("flow_1", "vibe");

    const dropped = captured("stage.dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.ext.from).toBe("studio");
    expect(dropped[0]!.ext.to).toBe("vibe");
    expect(dropped[0]!.ext.flowId).toBe("flow_1");
  });

  it("emits stage.dropped when re-entering the same stage", () => {
    enter("flow_1", "vibe");
    enter("flow_1", "vibe");

    expect(captured("stage.dropped")).toHaveLength(1);
    expect(captured("stage.entered")).toHaveLength(2);
  });
});

describe("resetStageTracking", () => {
  it("clears only the requested flow", () => {
    enter("flow_a", "gallery");
    enter("flow_b", "studio");
    resetStageTracking("flow_a");
    enter("flow_a", "hum");
    enter("flow_b", "vibe");

    const entered = captured("stage.entered");
    expect(entered[2]!.ext.flowId).toBe("flow_a");
    expect(entered[2]!.ext.from).toBeNull();
    expect(entered[2]!.ext.dwellMs).toBeNull();

    const dropped = captured("stage.dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.ext.flowId).toBe("flow_b");
    expect(dropped[0]!.ext.from).toBe("studio");
    expect(dropped[0]!.ext.to).toBe("vibe");
  });
});

describe("trackStageCompleted", () => {
  it("reports dwell relative to the same flow's last entered stage", () => {
    enter("flow_1", "save");
    complete("flow_1", "save", { songId: "song_1" });

    const completed = captured("stage.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]!.ext.stage).toBe("save");
    expect(typeof completed[0]!.ext.dwellMs).toBe("number");
    expect(completed[0]!.ext.flowId).toBe("flow_1");
    expect(completed[0]!.ext.songId).toBe("song_1");
  });

  it("reports null dwell when the flow has no retained stage", () => {
    complete("flow_1", "save");

    const completed = captured("stage.completed");
    expect(completed[0]!.ext.dwellMs).toBeNull();
    expect(completed[0]!.ext.flowId).toBe("flow_1");
  });
});

describe("retained flow cleanup", () => {
  it("evicts the least recently used flow when the bound is exceeded", () => {
    enter("flow_oldest", "hum");
    for (let index = 0; index < STAGE_TRACKING_MAX_RETAINED_FLOWS; index += 1) {
      enter(`flow_${index}`, "hum");
    }

    complete("flow_oldest", "hum");
    complete(`flow_${STAGE_TRACKING_MAX_RETAINED_FLOWS - 1}`, "hum");

    const completed = captured("stage.completed");
    expect(completed[0]!.ext.dwellMs).toBeNull();
    expect(typeof completed[1]!.ext.dwellMs).toBe("number");
  });
});
