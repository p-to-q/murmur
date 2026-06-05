import type { MelodySelectionKind } from "@/modules/shared/types";

export type MelodyOriginCopy = {
  label: string;
  detailBody: string;
  studioBody: string;
  promptPlaceholder: string;
};

export function getMelodyOriginCopy(
  kind: MelodySelectionKind | undefined,
  t: (key: string) => string,
): MelodyOriginCopy {
  switch (kind) {
    case "intent":
      return {
        label: t("melody_origin.intent.label") || "INTENT",
        detailBody:
          t("melody_origin.intent.detail") ||
          "Kept close to the line you hummed, with only a light touch.",
        studioBody:
          t("melody_origin.intent.studio") ||
          "Stay near the contour you sang. Use edits to frame it, not rewrite it.",
        promptPlaceholder:
          t("melody_origin.intent.prompt") ||
          "keep the melody close, just warm it up a little…",
      };
    case "musical":
      return {
        label: t("melody_origin.musical.label") || "MUSICAL",
        detailBody:
          t("melody_origin.musical.detail") ||
          "Leaned into the prettier reading so the melody lands more like a finished song.",
        studioBody:
          t("melody_origin.musical.studio") ||
          "This take is already leaning toward the sweeter reading. Polish the landing and texture.",
        promptPlaceholder:
          t("melody_origin.musical.prompt") ||
          "make it glossier, wider, a little more cinematic…",
      };
    case "corrected":
    default:
      return {
        label: t("melody_origin.corrected.label") || "CORRECTED",
        detailBody:
          t("melody_origin.corrected.detail") ||
          "Tuned the melody toward what you meant to sing while keeping your phrase shape.",
        studioBody:
          t("melody_origin.corrected.studio") ||
          "Keep the phrase shape, then gently push the arrangement into a cleaner, stronger pocket.",
        promptPlaceholder:
          t("melody_origin.corrected.prompt") ||
          "make it a touch cleaner, fewer drums, more bass…",
      };
  }
}
