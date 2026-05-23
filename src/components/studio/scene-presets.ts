import type { EditToken } from "@/modules/strummer/apply-edit";
import type { TKey } from "@/lib/i18n/dict";

/**
 * Scene = a small composed edit. Each scene maps to one or more EditTokens.
 * The Studio applies them in order via applyEdit.
 *
 * Keep this list tight — too many scenes turns the studio into a DAW. Pick
 * scenes that read like *moods*, not *parameters*. Parameters belong on the
 * sliders below.
 */
export type Scene = {
  id: string;
  labelKey: TKey;
  descKey: TKey;
  tokens: EditToken[];
  /** Particle accent color — used by the diffusing dots at the bottom of the card */
  accent: string;
};

export const SCENES: Scene[] = [
  { id: "warm",       labelKey: "scene.warm.label",       descKey: "scene.warm.desc",       tokens: ["warmer"],                                      accent: "#FF8A5C" },
  { id: "cinematic",  labelKey: "scene.cinematic.label",  descKey: "scene.cinematic.desc",  tokens: ["cinematic"],                                   accent: "#C9B6E4" },
  { id: "minimal",    labelKey: "scene.minimal.label",    descKey: "scene.minimal.desc",    tokens: ["restore_all", "no_drums", "less_strings"],    accent: "#A7B8C8" },
  { id: "lush",       labelKey: "scene.lush.label",       descKey: "scene.lush.desc",       tokens: ["more_strings", "more_bass", "more_texture"], accent: "#F4C87A" },
  { id: "brighter",   labelKey: "scene.brighter.label",   descKey: "scene.brighter.desc",   tokens: ["brighter"],                                    accent: "#FFB66E" },
];
