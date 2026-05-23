// Legacy vibe-presets shim — re-exports from the canonical presets module.
// Original VIBE_PRESETS with extended fields (energyHint, bpmRange, etc.)
// are kept here for backward compatibility. New code should use @/presets/vibes.

export { VIBE_PRESETS } from "@/presets/vibes";
export type { VibePreset } from "@/presets/vibes";
