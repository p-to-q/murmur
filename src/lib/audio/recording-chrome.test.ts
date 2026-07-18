import { describe, expect, it } from "bun:test";
import {
  shouldShowRecordingChrome,
  visibleRecordingProgress,
} from "./recording-chrome";

describe("recording chrome", () => {
  it("keeps the timer absent before the user starts capture", () => {
    expect(
      shouldShowRecordingChrome({ isRecording: false, isStartingCapture: false }),
    ).toBe(false);
  });

  it("keeps the timer mounted from microphone startup through recording", () => {
    expect(
      shouldShowRecordingChrome({ isRecording: false, isStartingCapture: true }),
    ).toBe(true);
    expect(
      shouldShowRecordingChrome({ isRecording: true, isStartingCapture: false }),
    ).toBe(true);
  });

  it("shows a bright start cap before the real recording clock advances", () => {
    expect(visibleRecordingProgress(0, true)).toBe(0.004);
    expect(visibleRecordingProgress(0.5, true)).toBe(0.5);
    expect(visibleRecordingProgress(0.5, false)).toBe(0);
  });
});
