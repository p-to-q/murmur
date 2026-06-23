import { VIBE_PRESETS } from "@/presets/vibes";
import type { VibeVersion } from "@/modules/shared/types";

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
