import { describe, expect, it } from "bun:test";
import {
  clampRecordingElapsedMs,
  formatRecordingElapsedSeconds,
  recordingProgressFromElapsed,
} from "./recording-progress";

describe("recording progress helpers", () => {
  it("clamps elapsed time to the capture window", () => {
    expect(clampRecordingElapsedMs(-120)).toBe(0);
    expect(clampRecordingElapsedMs(7_250)).toBe(7_250);
    expect(clampRecordingElapsedMs(16_000)).toBe(15_000);
  });

  it("derives continuous progress from elapsed time", () => {
    expect(recordingProgressFromElapsed(0)).toBe(0);
    expect(recordingProgressFromElapsed(7_500)).toBe(0.5);
    expect(recordingProgressFromElapsed(20_000)).toBe(1);
  });

  it("formats tenths so users can see the real capture duration", () => {
    expect(formatRecordingElapsedSeconds(0)).toBe("00.0");
    expect(formatRecordingElapsedSeconds(980)).toBe("01.0");
    expect(formatRecordingElapsedSeconds(14_960)).toBe("15.0");
    expect(formatRecordingElapsedSeconds(20_000)).toBe("15.0");
  });
});
