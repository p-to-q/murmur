import { describe, expect, it } from "bun:test";
import { inputLevelLabelKey, nextInputLevelDecision } from "./input-level";

describe("nextInputLevelDecision", () => {
  it("does not mark the opening warmup as quiet before any stable signal", () => {
    let decision = {
      state: "idle" as const,
      quietSinceMs: null as number | null,
      hasHeardSignal: false,
    };

    decision = nextInputLevelDecision({
      rms: 0.008,
      elapsedMs: 900,
      quietSinceMs: decision.quietSinceMs,
      hasHeardSignal: decision.hasHeardSignal,
    });

    expect(decision.state).toBe("idle");
    expect(decision.hasHeardSignal).toBe(false);
  });

  it("switches to heard once a normal hum crosses the stable threshold", () => {
    const decision = nextInputLevelDecision({
      rms: 0.02,
      elapsedMs: 700,
      quietSinceMs: null,
      hasHeardSignal: false,
    });

    expect(decision.state).toBe("heard");
    expect(decision.hasHeardSignal).toBe(true);
  });

  it("waits for sustained quiet after warmup before warning", () => {
    const first = nextInputLevelDecision({
      rms: 0.008,
      elapsedMs: 2000,
      quietSinceMs: null,
      hasHeardSignal: false,
    });

    expect(first.state).toBe("idle");

    const second = nextInputLevelDecision({
      rms: 0.008,
      elapsedMs: 3500,
      quietSinceMs: first.quietSinceMs,
      hasHeardSignal: first.hasHeardSignal,
    });

    expect(second.state).toBe("quiet");
  });

  it("keeps the meter in heard for soft but still valid input after it has locked on", () => {
    const decision = nextInputLevelDecision({
      rms: 0.014,
      elapsedMs: 2600,
      quietSinceMs: null,
      hasHeardSignal: true,
    });

    expect(decision.state).toBe("heard");
    expect(decision.hasHeardSignal).toBe(true);
  });

  it("maps every meter state to explicit product copy", () => {
    expect(inputLevelLabelKey("idle")).toBe("hum.level.idle");
    // Quiet copy rotates between two variants to feel less naggy.
    expect(["hum.level.quiet.1", "hum.level.quiet.2"]).toContain(
      inputLevelLabelKey("quiet"),
    );
    expect(inputLevelLabelKey("heard")).toBe("hum.level.heard");
  });
});
