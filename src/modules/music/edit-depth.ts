import type { EditDepth, VibeVersion } from "@/modules/shared/types";

export function deriveEditDepth(editCount: number): EditDepth {
  if (!Number.isFinite(editCount) || editCount <= 0) return "fresh";
  if (editCount >= 4) return "reworked";
  return "shaped";
}

export function normalizeEditCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function bumpVersionEditState(version: VibeVersion, delta = 1): VibeVersion {
  const nextCount = Math.max(0, version.editCount + delta);
  return {
    ...version,
    editCount: nextCount,
    editDepth: deriveEditDepth(nextCount),
  };
}

export function resetVersionEditState(version: VibeVersion): VibeVersion {
  return {
    ...version,
    editCount: 0,
    editDepth: "fresh",
  };
}

export function getEditDepthLabel(depth: EditDepth | undefined, t: (key: string) => string): string {
  switch (depth) {
    case "shaped":
      return t("edit_depth.shaped") || "Shaped";
    case "reworked":
      return t("edit_depth.reworked") || "Reworked";
    case "fresh":
    default:
      return t("edit_depth.fresh") || "Fresh";
  }
}
