import { VIBE_PRESETS } from "@/presets/vibes";
import type { SongProvenance, VibeVersion } from "@/modules/shared/types";

type SaveProvenanceSource = Pick<
  VibeVersion,
  "originFlowId" | "draftId" | "generation" | "sourceType" | "captureQuality"
>;

/**
 * Build the creation provenance persisted with a saved song (#297): flow,
 * recording operation, generation batch/clip, and source. The generation
 * operation identity (batch/clip ids) is threaded through by durable recovery
 * (#300); only fields the version actually carries are included.
 */
export function buildSaveProvenance(version: SaveProvenanceSource): SongProvenance {
  const provenance: SongProvenance = {};
  if (version.originFlowId) provenance.flow = version.originFlowId;
  if (version.draftId) {
    provenance.draftId = version.draftId;
    // The hum→draft session is the client's recording-operation identity.
    provenance.recordingOperationId = version.draftId;
  }
  const generation = version.generation;
  if (generation) {
    provenance.generationBatchIndex = generation.batchIndex;
    if (generation.batchOperationId) provenance.generationBatchId = generation.batchOperationId;
    if (generation.operationId) provenance.generationClipId = generation.operationId;
    if (generation.audioSha256) provenance.generationAudioSha256 = generation.audioSha256;
  }
  if (version.sourceType) provenance.sourceType = version.sourceType;
  if (version.captureQuality) provenance.captureQuality = version.captureQuality;
  return provenance;
}

type NameSaveMetadataSource = Pick<
  VibeVersion,
  "generation" | "tags" | "vibe" | "visualConfig"
>;

export function buildNameSaveMetadata(version: NameSaveMetadataSource): {
  vibe: string;
  vibeEn: string;
} {
  const vibe = cleanText(version.vibe) || "unknown";
  const preset = VIBE_PRESETS.find((candidate) => candidate.id === version.vibe);
  const vibeEn =
    firstCleanText(
      version.generation?.vibeLabel.en,
      version.visualConfig.visualFacets?.genre,
      preset?.label.en,
      version.tags[0],
      version.generation?.prompt,
      vibe,
    ) || vibe;

  return { vibe, vibeEn };
}

function firstCleanText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
