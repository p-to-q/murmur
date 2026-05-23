// Stainer — single transcription orchestrator. All UI must call this — never
// import providers directly. Provider order is informed by NEXT_PUBLIC_TRANSCRIPTION_PROVIDER
// but the facade always falls through to a fixture so the experience never
// dead-ends on the user.
//
// Layers (live recordings):
//   1. browser-yin           — zero-deps, offline, ~instant
//   2. remote-python (PYIN)  — higher accuracy, requires worker URL
//   3. browser-basic-pitch   — opt-in upgrade, ~7MB model
//   4. fixture               — last-resort demo melody so the UI never blocks
//
// When the caller does not supply an audioBlob (e.g. "Try the example melody"
// button), fixture is the only sensible provider.

import type {
  TranscriptionInput,
  TranscriptionResult,
} from "@/modules/shared/types";
import { transcribeFixture } from "./providers/fixture";
import { transcribeRemotePython } from "./providers/remote-python";
import { transcribeBrowserBasicPitch } from "./providers/browser-basic-pitch";
import { transcribeBrowserYIN } from "./providers/browser-yin";
import {
  getConfiguredTranscriptionProvider,
  getResolvedProviderOrder,
  type RuntimeProviderStatus,
} from "./runtime";

type Provider = (i: TranscriptionInput) => Promise<TranscriptionResult>;

const PROVIDERS: Record<RuntimeProviderStatus["id"], Provider> = {
  "remote-python": transcribeRemotePython,
  "browser-yin": transcribeBrowserYIN,
  "browser-basic-pitch": transcribeBrowserBasicPitch,
  fixture: transcribeFixture,
};

function liveProviders(): Provider[] {
  const configured = getConfiguredTranscriptionProvider();
  return getResolvedProviderOrder(configured).map((status) => PROVIDERS[status.id]);
}

export async function transcribeWithStainer(
  input: TranscriptionInput,
): Promise<TranscriptionResult> {
  // No audio at all → only fixture makes sense.
  const providers = !input.audioBlob
    ? [transcribeFixture]
    : liveProviders();

  const warnings: string[] = [];
  for (const provider of providers) {
    try {
      const result = await provider(input);
      return { ...result, warnings: [...result.warnings, ...warnings] };
    } catch (error) {
      warnings.push(
        `${provider.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // Fixture is in the list — this only fires if even fixture throws.
  throw new Error(`All Stainer providers failed: ${warnings.join("; ")}`);
}
