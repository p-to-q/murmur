import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  clearRecentEvents,
  getRecentEvents,
  recordRecentEvent,
} from "./recent-events";

function baseEvent(overrides: {
  event: string;
  level?: "info" | "warn" | "error";
  ext?: Record<string, unknown>;
}) {
  return {
    event: overrides.event,
    level: overrides.level ?? "info",
    ts: "2026-06-03T06:30:00.000Z",
    route: "/api/transcribe",
    requestId: "req_test",
    userId: "usr_test",
    shell: "web",
    durationMs: 12,
    ext: overrides.ext ?? {},
  } as const;
}

describe("recent events ring buffer", () => {
  beforeEach(() => clearRecentEvents());
  afterEach(() => clearRecentEvents());

  it("ignores events outside the audio pipeline allow list", () => {
    recordRecentEvent(baseEvent({ event: "song.created" }));
    expect(getRecentEvents()).toHaveLength(0);
  });

  it("stores tracked events most-recent first", () => {
    recordRecentEvent(baseEvent({ event: "transcribe.requested" }));
    recordRecentEvent(baseEvent({ event: "transcribe.completed" }));
    const events = getRecentEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.event).toBe("transcribe.completed");
    expect(events[1]?.event).toBe("transcribe.requested");
  });

  it("caps the buffer at 32 entries", () => {
    for (let i = 0; i < 40; i += 1) {
      recordRecentEvent(baseEvent({ event: "transcribe.completed" }));
    }
    expect(getRecentEvents()).toHaveLength(32);
  });

  it("redacts raw audio fields and long strings", () => {
    recordRecentEvent(
      baseEvent({
        event: "capture.failed",
        ext: {
          rawAudio: "abc",
          audioBlob: "binary",
          message: "x".repeat(3000),
          targetInstrument: "piano",
        },
      }),
    );
    const [event] = getRecentEvents();
    expect(event?.ext.rawAudio).toBe("[redacted]");
    expect(event?.ext.audioBlob).toBe("[redacted]");
    expect(event?.ext.targetInstrument).toBe("piano");
    expect(typeof event?.ext.message).toBe("string");
    expect((event?.ext.message as string).length).toBeLessThan(2100);
    expect((event?.ext.message as string).endsWith("…")).toBe(true);
  });

  it("summarises large arrays so we never dump raw note buffers", () => {
    const longArray = new Array(64).fill({ pitch: 60 });
    recordRecentEvent(
      baseEvent({
        event: "arrangement.generated",
        ext: { rawNotes: longArray, vibes: ["sunset", "rainy"] },
      }),
    );
    const [event] = getRecentEvents();
    expect(event?.ext.rawNotes).toBe("[redacted]");
    expect(event?.ext.vibes).toEqual(["sunset", "rainy"]);
  });
});
