import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  resetStageTracking,
  trackStageCompleted,
  trackStageEntered,
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

function captured(msg: string): LoggedLine[] {
  return lines.filter((line) => line.msg === msg);
}

beforeEach(() => {
  resetStageTracking();
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
  resetStageTracking();
});

describe("trackStageEntered", () => {
  it("emits stage.entered with null origin on the first stage", () => {
    trackStageEntered("hum");

    const entered = captured("stage.entered");
    expect(entered).toHaveLength(1);
    expect(entered[0]!.ext.stage).toBe("hum");
    expect(entered[0]!.ext.from).toBeNull();
    expect(entered[0]!.ext.dwellMs).toBeNull();
    expect(captured("stage.dropped")).toHaveLength(0);
  });

  it("chains forward transitions with origin and dwell", () => {
    trackStageEntered("hum");
    trackStageEntered("vibe", { flowId: "flow_1", draftId: "draft_1" });

    const entered = captured("stage.entered");
    expect(entered).toHaveLength(2);
    expect(entered[1]!.ext.stage).toBe("vibe");
    expect(entered[1]!.ext.from).toBe("hum");
    expect(typeof entered[1]!.ext.dwellMs).toBe("number");
    expect(entered[1]!.ext.flowId).toBe("flow_1");
    expect(entered[1]!.ext.draftId).toBe("draft_1");
    expect(captured("stage.dropped")).toHaveLength(0);
  });

  it("emits stage.dropped when moving backwards in the funnel", () => {
    trackStageEntered("studio");
    trackStageEntered("vibe");

    const dropped = captured("stage.dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.ext.from).toBe("studio");
    expect(dropped[0]!.ext.to).toBe("vibe");
  });

  it("emits stage.dropped when re-entering the same stage", () => {
    trackStageEntered("vibe");
    trackStageEntered("vibe");

    expect(captured("stage.dropped")).toHaveLength(1);
    expect(captured("stage.entered")).toHaveLength(2);
  });
});

describe("resetStageTracking", () => {
  it("clears the origin so a new flow starts fresh", () => {
    trackStageEntered("gallery");
    resetStageTracking();
    trackStageEntered("hum");

    const entered = captured("stage.entered");
    expect(entered[1]!.ext.stage).toBe("hum");
    expect(entered[1]!.ext.from).toBeNull();
    expect(entered[1]!.ext.dwellMs).toBeNull();
    // A completed run restarting at hum is not a drop.
    expect(captured("stage.dropped")).toHaveLength(0);
  });
});

describe("trackStageCompleted", () => {
  it("reports dwell relative to the last entered stage", () => {
    trackStageEntered("save");
    trackStageCompleted("save", { songId: "song_1" });

    const completed = captured("stage.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]!.ext.stage).toBe("save");
    expect(typeof completed[0]!.ext.dwellMs).toBe("number");
    expect(completed[0]!.ext.songId).toBe("song_1");
  });

  it("reports null dwell when no stage was entered", () => {
    trackStageCompleted("save");

    const completed = captured("stage.completed");
    expect(completed[0]!.ext.dwellMs).toBeNull();
  });
});
