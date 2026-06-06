import { selectGenerationMelody } from "@/modules/music/humming-engine";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import { buildFixtureTranscriptionResult } from "@/modules/stainer/providers/fixture";
import type { VibeVersion } from "@/modules/shared/types";

export type DemoFlowState = {
  draftId: string;
  flowId: string;
  versions: VibeVersion[];
  currentVersion: VibeVersion;
};

export function buildDemoFlowState(): DemoFlowState {
  const result = buildFixtureTranscriptionResult(0);
  const selectedMelody = selectGenerationMelody(result, { repairBias: 0 });
  const draftId = "demo-fixture-draft";
  const flowId = "demo-fixture-flow";
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
