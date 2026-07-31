import { createCompositionEvent } from "@/lib/db/queries/composition-events";
import { log } from "@/lib/observability/log";
import type { VerifiedMusicOutput } from "@/lib/platform/music-worker-output";

const ROUTE = "/api/music/generate";

export interface MusicGenerationEvidenceInput {
  eventId?: string;
  userId: string;
  requestId: string;
  batchId: string | null;
  clipId: string | null;
  mode: "serverless" | "http";
  model: string;
  outputSha256: string;
  outputBytes: number;
  duration: number;
  styleMix: number;
  quality?: VerifiedMusicOutput;
}

export async function recordMusicGenerationEvidence(
  input: MusicGenerationEvidenceInput,
): Promise<boolean> {
  try {
    await createCompositionEvent({
      id: input.eventId,
      userId: input.userId,
      generationBatchId: input.batchId,
      generationClipId: input.clipId,
      eventKind: "generation.completed",
      source: "server",
      payload: buildMusicGenerationEvidencePayload(input),
    });
    return true;
  } catch (error) {
    log("composition_event.write_failed", {
      eventKind: "generation.completed",
      reason: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      requestId: input.requestId,
      userId: input.userId,
      level: "warn",
    });
    return false;
  }
}

export function buildMusicGenerationEvidencePayload(
  input: MusicGenerationEvidenceInput,
): Record<string, unknown> {
  const verified = input.quality;
  return {
    schemaVersion: 1,
    requestId: input.requestId,
    mode: input.mode,
    model: input.model.slice(0, 128),
    duration: input.duration,
    styleMix: input.styleMix,
    outputBytes: input.outputBytes,
    outputSha256: input.outputSha256,
    gateVersion: verified?.quality.version ?? null,
    qualityMetrics: boundedNumberMap(verified?.quality.metrics),
    evidence: verified?.diagnostics.evidence ?? null,
    candidateCount: verified?.diagnostics.candidateCount ?? null,
    workerWallMs: verified?.diagnostics.workerWallMs ?? null,
    totalGenerationMs: verified?.diagnostics.totalGenerationMs ?? null,
    estimatedCostUsd: verified?.diagnostics.estimatedCostUsd ?? null,
    runtime: boundedStringMap(verified?.diagnostics.runtime),
    inputReceipt: verified?.diagnostics.inputReceipt ?? null,
    candidates: (verified?.diagnostics.candidates ?? []).slice(0, 3).map(
      (candidate) => ({
        ...candidate,
        candidateId: candidate.candidateId?.slice(0, 64) ?? null,
        quality: candidate.quality
          ? {
              ...candidate.quality,
              failures: candidate.quality.failures
                .slice(0, 16)
                .map((failure) => failure.slice(0, 128)),
              metrics: boundedNumberMap(candidate.quality.metrics),
            }
          : null,
      }),
    ),
  };
}

function boundedNumberMap(
  input: Record<string, number> | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(input ?? {}).slice(0, 32).map(([key, value]) => [
      key.slice(0, 64),
      value,
    ]),
  );
}

function boundedStringMap(
  input: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input ?? {}).slice(0, 32).map(([key, value]) => [
      key.slice(0, 64),
      value.slice(0, 128),
    ]),
  );
}
