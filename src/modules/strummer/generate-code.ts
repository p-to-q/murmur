import type { ArrangementState } from "@/modules/shared/types";

/** Generate a safe code-like representation — do NOT execute LLM output as code */
export function generateStrummerCode(state: ArrangementState): string {
  return [
    `melody("${state.melody.currentPattern}").sound("${state.melody.instrument}").gain(${state.melody.intensity.toFixed(2)})`,
    `chords("${state.chords.currentPattern}").sound("${state.chords.instrument}").gain(${state.chords.intensity.toFixed(2)})`,
    `strings("${state.strings.currentPattern}").sound("${state.strings.instrument}").gain(${state.strings.intensity.toFixed(2)})`,
    `drums("${state.drums.currentPattern}").sound("${state.drums.instrument}").gain(${state.drums.intensity.toFixed(2)})`,
    `bass("${state.bass.currentPattern}").sound("${state.bass.instrument}").gain(${state.bass.intensity.toFixed(2)})`,
  ].join("\n");
}
