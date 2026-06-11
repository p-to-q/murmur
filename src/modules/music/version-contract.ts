import type { VibeVersion, VersionGeneration } from "@/modules/shared/types";

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
  if (!version.generation) return true;
  return hasReadyGeneratedAudio(version.generation);
}

export function getSaveBlockReason(
  version: VibeVersion,
): "generation_pending" | "generation_failed" | null {
  const generation = version.generation;
  if (!generation) return null;
  if (hasReadyGeneratedAudio(generation)) return null;
  return generation.status === "error" ? "generation_failed" : "generation_pending";
}
