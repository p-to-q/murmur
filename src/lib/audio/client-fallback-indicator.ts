import type { TranscriptionProvider } from "@/modules/shared/types";

export function shouldShowClientFallbackIndicator(input: {
  provider: TranscriptionProvider;
  alreadyShown: boolean;
}): boolean {
  return input.provider === "client_pyin" && !input.alreadyShown;
}
