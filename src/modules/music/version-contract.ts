import type { VibeVersion, VersionGeneration } from "@/modules/shared/types";

export type VersionReadinessBlockReason =
  | "generation_pending"
  | "generation_failed";

function hasReadyGeneratedAudio(
  generation: VersionGeneration | undefined,
): generation is VersionGeneration & { status: "ready"; audioUrl: string } {
  return generation?.status === "ready" && typeof generation.audioUrl === "string" && generation.audioUrl.length > 0;
}

/**
 * Murmur's save contract:
 * - legacy arrangement versions are always saveable because preview + render
 *   share the same arrangement source of truth
 * - generated whole-clip versions are saveable only once the exact clip the
 *   user heard exists as a concrete audio URL we can transcode and persist
 */
export function canSaveHeardVersion(version: VibeVersion): boolean {
  return isVersionReadyForStudio(version);
}

export function isVersionReadyForStudio(version: VibeVersion): boolean {
  if (!version.generation) return true;
  return hasReadyGeneratedAudio(version.generation);
}

export function getSaveBlockReason(
  version: VibeVersion,
): VersionReadinessBlockReason | null {
  return getVersionReadinessBlockReason(version);
}

export function getVersionReadinessBlockReason(
  version: VibeVersion,
): VersionReadinessBlockReason | null {
  const generation = version.generation;
  if (!generation) return null;
  if (hasReadyGeneratedAudio(generation)) return null;
  return generation.status === "error" ? "generation_failed" : "generation_pending";
}
