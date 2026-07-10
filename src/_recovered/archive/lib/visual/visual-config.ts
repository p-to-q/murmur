// Visual Engine — generates HTML/Canvas visual configs for each song
// These configs drive both the in-app visual player and the poster/MP4 export

export interface VisualConfig {
  preset: string;
  colors: string[];
  particleDensity: number;
  pulseIntensity: number;
  posterBg: string;
}

const VISUAL_PRESETS: Record<
  string,
  { colors: [string, string]; posterBg: string; particleDensity: number; pulseIntensity: number }
> = {
  warm_gradient: {
    colors: ["#F7C98B", "#E9A06D"],
    posterBg: "linear-gradient(135deg, #F7C98B 0%, #E9A06D 100%)",
    particleDensity: 0.5,
    pulseIntensity: 0.4,
  },
  lofi_dust: {
    colors: ["#C9B6E4", "#A7B8C8"],
    posterBg: "linear-gradient(135deg, #C9B6E4 0%, #A7B8C8 100%)",
    particleDensity: 0.3,
    pulseIntensity: 0.3,
  },
  cinematic_dark: {
    colors: ["#22303A", "#A7B8C8"],
    posterBg: "linear-gradient(160deg, #22303A 0%, #3a5060 50%, #A7B8C8 100%)",
    particleDensity: 0.2,
    pulseIntensity: 0.5,
  },
  neon_city: {
    colors: ["#1a1a2e", "#A7B8C8"],
    posterBg: "linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
    particleDensity: 0.6,
    pulseIntensity: 0.7,
  },
  confetti: {
    colors: ["#EBCB8B", "#E9A06D"],
    posterBg: "linear-gradient(135deg, #EBCB8B 0%, #f5d98b 50%, #E9A06D 100%)",
    particleDensity: 0.8,
    pulseIntensity: 0.8,
  },
  rain_drops: {
    colors: ["#A7B8C8", "#C9B6E4"],
    posterBg: "linear-gradient(180deg, #A7B8C8 0%, #C9B6E4 100%)",
    particleDensity: 0.4,
    pulseIntensity: 0.35,
  },
  dream_particles: {
    colors: ["#C9B6E4", "#FFFDF8"],
    posterBg: "linear-gradient(135deg, #C9B6E4 0%, #e8d8f5 50%, #FFFDF8 100%)",
    particleDensity: 0.4,
    pulseIntensity: 0.3,
  },
  synth_grid: {
    colors: ["#22303A", "#C9B6E4"],
    posterBg: "linear-gradient(135deg, #22303A 0%, #2d3d4a 60%, #C9B6E4 100%)",
    particleDensity: 0.5,
    pulseIntensity: 0.6,
  },
  folk_warm: {
    colors: ["#EBCB8B", "#F7F3EA"],
    posterBg: "linear-gradient(135deg, #EBCB8B 0%, #f5e6c8 50%, #F7F3EA 100%)",
    particleDensity: 0.3,
    pulseIntensity: 0.35,
  },
  sakura_fall: {
    colors: ["#F7C98B", "#C9B6E4"],
    posterBg: "linear-gradient(135deg, #F7C98B 0%, #f0c0d8 50%, #C9B6E4 100%)",
    particleDensity: 0.5,
    pulseIntensity: 0.45,
  },
  midnight_glow: {
    colors: ["#22303A", "#8B8680"],
    posterBg: "linear-gradient(160deg, #22303A 0%, #2c3b45 60%, #4a5568 100%)",
    particleDensity: 0.25,
    pulseIntensity: 0.4,
  },
  pixel_art: {
    colors: ["#EBCB8B", "#22303A"],
    posterBg: "linear-gradient(135deg, #22303A 0%, #2d3f35 50%, #EBCB8B 100%)",
    particleDensity: 0.6,
    pulseIntensity: 0.7,
  },
};

export function buildVisualConfig(visualPreset: string, vibeColors?: [string, string]): VisualConfig {
  const preset = VISUAL_PRESETS[visualPreset] ?? VISUAL_PRESETS.warm_gradient!;
  return {
    preset: visualPreset,
    colors: vibeColors ?? preset.colors,
    particleDensity: preset.particleDensity,
    pulseIntensity: preset.pulseIntensity,
    posterBg: preset.posterBg,
  };
}
