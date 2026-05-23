// Legacy fixture provider — shim that delegates to the canonical modules/ implementation.
// Do not add new logic here; use src/modules/stainer/providers/fixture.ts instead.

import type { TranscriptionInput, TranscriptionResult } from "@/modules/shared/types";
import { transcribeFixture } from "@/modules/stainer/providers/fixture";

export const fixtureProvider = {
  name: "fixture" as const,
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    return transcribeFixture(input);
  },
};
