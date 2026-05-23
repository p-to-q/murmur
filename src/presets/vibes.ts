export const VIBE_PRESETS = [
  {
    id: "sunset",
    label: "黄昏",
    tags: ["warm piano", "soft drums", "gold particles"],
    gradient: "linear-gradient(135deg, #F4C87A, #E9A06D 45%, #C9B6E4)",
    energy: 0.45,
    visualPreset: "warm_particles",
    titleGenerator: () => "Soft Evening",
  },
  {
    id: "bedroom",
    label: "卧室",
    tags: ["lo-fi", "quiet bass", "dust texture"],
    gradient: "linear-gradient(135deg, #FFF0D6, #A7B8C8 60%, #8B8680)",
    energy: 0.35,
    visualPreset: "dust_room",
    titleGenerator: () => "Room Light",
  },
  {
    id: "cinematic",
    label: "电影",
    tags: ["strings", "slow pulse", "wide reverb"],
    gradient: "linear-gradient(135deg, #22303A, #A7B8C8, #F7F3EA)",
    energy: 0.55,
    visualPreset: "end_credits",
    titleGenerator: () => "Tiny Movie",
  },
  {
    id: "party",
    label: "派对",
    tags: ["bright synth", "stronger drums", "confetti"],
    gradient: "linear-gradient(135deg, #E9A06D, #F7C5CC, #C9B6E4)",
    energy: 0.85,
    visualPreset: "confetti_pulse",
    titleGenerator: () => "Small Party",
  },
  {
    id: "rain",
    label: "雨天",
    tags: ["soft keys", "rain air", "slow bass"],
    gradient: "linear-gradient(135deg, #A7B8C8, #D8DDD8, #FFFDF8)",
    energy: 0.3,
    visualPreset: "rain_glass",
    titleGenerator: () => "Window Song",
  },
  {
    id: "synth",
    label: "合成器",
    tags: ["synth pad", "moving bass", "night glow"],
    gradient: "linear-gradient(135deg, #C9B6E4, #22303A, #E9A06D)",
    energy: 0.7,
    visualPreset: "synth_glow",
    titleGenerator: () => "Little Signal",
  },
] as const;

export type VibeId = (typeof VIBE_PRESETS)[number]["id"];
export type VibePreset = (typeof VIBE_PRESETS)[number];
