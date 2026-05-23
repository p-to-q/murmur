// Legacy remote provider — shim that delegates to the canonical modules/ implementation.
import type { TranscriptionInput, TranscriptionResult } from "@/modules/shared/types";
import { transcribeRemotePython } from "@/modules/stainer/providers/remote-python";

export const remoteBasicPitchProvider = {
  name: "remote-basic-pitch" as const,
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    return transcribeRemotePython(input);
  },
};
