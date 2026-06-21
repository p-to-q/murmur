import type { Lang } from "@/lib/i18n/dict";
import { displayStyleLabelForGenre } from "@/lib/music/vibe-prompts";
import { VIBE_PRESETS } from "@/presets/vibes";

/**
 * Human-readable vibe label for a saved song.
 *
 * Magenta songs store a generated id in `vibe` (e.g. "mgt-14uu8cf") — for
 * display, fall back to the song's first tag, which is the genre half of
 * the prompt ("swing jazz", "city pop", …). Legacy songs store a readable
 * preset id ("sunset") and pass through unchanged.
 */
export function displayVibeLabel(vibe: string, tags?: string[] | null, lang: Lang = "en"): string {
  if (vibe.startsWith("mgt-")) return displayStyleLabelForGenre(tags?.[0] ?? "magenta", lang);
  const legacy = VIBE_PRESETS.find((preset) => preset.id === vibe);
  if (legacy) return legacy.label[lang];
  return vibe;
}
