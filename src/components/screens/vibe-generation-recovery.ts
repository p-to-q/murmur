import type { VibeVersion } from "@/modules/shared/types";

export type VibeGenerationRecovery = {
  ctaKey: string;
  ctaFallback: string;
  detailKey: string;
  detailFallback: string;
};

export function canRetryGeneration(version: VibeVersion): boolean {
  const code = version.generation?.errorCode;
  return code !== "insufficient_notes" && code !== "rate_limited";
}

export function generationErrorRecovery(version: VibeVersion): VibeGenerationRecovery {
  switch (version.generation?.errorCode) {
    case "background_canceled":
      return {
        ctaKey: "vibe.retry",
        ctaFallback: "Retry",
        detailKey: "vibe.gen.background_canceled",
        detailFallback:
          "Brewing stopped after Murmur stayed in the background. Retry when you're ready to start again.",
      };
    case "insufficient_notes":
      return {
        ctaKey: "vibe.gen.topup",
        ctaFallback: "Top up",
        detailKey: "vibe.gen.insufficient_notes",
        detailFallback: "Out of notes — top up to brew more.",
      };
    case "rate_limited":
      return {
        ctaKey: "vibe.gen.wait",
        ctaFallback: "Try later",
        detailKey: "vibe.gen.rate_limited",
        detailFallback: "Too many generations in a row — try again shortly.",
      };
    case "billing_unavailable":
      return {
        ctaKey: "vibe.retry",
        ctaFallback: "Retry",
        detailKey: "vibe.gen.billing_unavailable",
        detailFallback: "Notes ledger unavailable — try again in a bit.",
      };
    case "worker_unconfigured":
      return {
        ctaKey: "vibe.retry",
        ctaFallback: "Retry",
        detailKey: "vibe.gen.worker_unconfigured",
        detailFallback: "Music engine is not connected yet.",
      };
    case "worker_overloaded":
      return {
        ctaKey: "vibe.retry",
        ctaFallback: "Retry",
        detailKey: "vibe.gen.worker_overloaded",
        detailFallback: "Music engine is busy — please try again shortly.",
      };
    default:
      return {
        ctaKey: "vibe.retry",
        ctaFallback: "Retry",
        detailKey: "vibe.gen.failed",
        detailFallback: "Didn't brew — tap to retry",
      };
  }
}
