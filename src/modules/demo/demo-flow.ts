import { selectGenerationMelody } from "@/modules/music/humming-engine";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import {
  createMagentaVersions,
  checkMusicEngineAvailable,
} from "@/modules/magenta/generate-magenta-versions";
import { buildFixtureTranscriptionResult } from "@/modules/stainer/providers/fixture";
import type { VibeVersion } from "@/modules/shared/types";

export type DemoFlowState = {
  draftId: string;
  flowId: string;
  versions: VibeVersion[];
  currentVersion: VibeVersion;
};

function buildDemoMelodyContext() {
  const result = buildFixtureTranscriptionResult(0);
  const selectedMelody = selectGenerationMelody(result, { repairBias: 0 });
  const draftId = `demo-${crypto.randomUUID()}`;
  const flowId = `demo-flow-${crypto.randomUUID()}`;
  return { selectedMelody, draftId, flowId };
}

/** Sync demo scaffold for tests — always uses the legacy engine. */
export function buildDemoFlowState(): DemoFlowState {
  const { selectedMelody, draftId, flowId } = buildDemoMelodyContext();
  const versions = generateVibeVersions(selectedMelody.melody, {
    draftId,
    originFlowId: flowId,
    sourceType: "demo",
    sourceMelodyKind: selectedMelody.kind,
  });

  return {
    draftId,
    flowId,
    versions,
    currentVersion: versions[0]!,
  };
}

/** Runtime demo entry — prefers Magenta only when the worker is reachable. */
export async function buildDemoFlowStateAsync(): Promise<DemoFlowState> {
  const { selectedMelody, draftId, flowId } = buildDemoMelodyContext();
  const useMagenta = await checkMusicEngineAvailable();
  const versions = useMagenta
    ? createMagentaVersions(selectedMelody.melody, {
        draftId,
        originFlowId: flowId,
        sourceType: "demo",
        sourceMelodyKind: selectedMelody.kind,
        batchIndex: 0,
        humBlob: null,
      })
    : generateVibeVersions(selectedMelody.melody, {
        draftId,
        originFlowId: flowId,
        sourceType: "demo",
        sourceMelodyKind: selectedMelody.kind,
      });

  return {
    draftId,
    flowId,
    versions,
    currentVersion: versions[0]!,
  };
}
