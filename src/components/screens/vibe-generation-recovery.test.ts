import { describe, expect, it } from "bun:test";
import type { VibeVersion } from "@/modules/shared/types";
import {
  canRetryGeneration,
  generationErrorRecovery,
} from "./vibe-generation-recovery";

const backgroundCanceledVersion = {
  generation: {
    status: "error",
    error: "Generation stopped while Murmur was in the background.",
    errorCode: "background_canceled",
  },
} as VibeVersion;

describe("Vibe background generation recovery", () => {
  it("offers an explicit retry instead of presenting a canceled clip as Brewing", () => {
    expect(canRetryGeneration(backgroundCanceledVersion)).toBe(true);
    expect(generationErrorRecovery(backgroundCanceledVersion)).toEqual({
      ctaKey: "vibe.retry",
      ctaFallback: "Retry",
      detailKey: "vibe.gen.background_canceled",
      detailFallback:
        "Brewing stopped after Murmur stayed in the background. Retry when you're ready to start again.",
    });
  });
});
