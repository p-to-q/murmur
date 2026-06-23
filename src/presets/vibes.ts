export const VIBE_PRESETS = [
  {
    id: "sunset",
    label: { zh: "落霞孤鹜", en: "Sunset" },
    tags: ["warm piano", "soft drums", "gold particles"],
    gradient: "linear-gradient(148deg, #FFBA5A 0%, #F0663E 42%, #B87FCC 100%)",
    energy: 0.45,
    visualPreset: "warm_particles",
    titleGenerator: () => "Soft Evening",
  },
  {
    id: "bedroom",
    label: { zh: "闲敲棋子", en: "Bedroom" },
    tags: ["lo-fi", "quiet bass", "dust texture"],
    gradient: "linear-gradient(148deg, #EDD9A3 0%, #8BAFC2 52%, #6A6472 100%)",
    energy: 0.35,
    visualPreset: "dust_room",
    titleGenerator: () => "Room Light",
  },
  {
    id: "cinematic",
    label: { zh: "大江东去", en: "Cinematic" },
    tags: ["strings", "slow pulse", "wide reverb"],
    gradient: "linear-gradient(148deg, #16242C 0%, #4E7D96 48%, #D8D0C4 100%)",
    energy: 0.55,
    visualPreset: "end_credits",
    titleGenerator: () => "Tiny Movie",
  },
  {
    id: "party",
    label: { zh: "东风夜放", en: "Party" },
    tags: ["bright synth", "stronger drums", "confetti"],
    gradient: "linear-gradient(148deg, #FF6E35 0%, #EE6AA0 42%, #9B70D0 100%)",
    energy: 0.85,
    visualPreset: "confetti_pulse",
    titleGenerator: () => "Small Party",
  },
  {
    id: "rain",
    label: { zh: "夜雨寄北", en: "Rainy" },
    tags: ["soft keys", "rain air", "slow bass"],
    gradient: "linear-gradient(148deg, #5A8EAA 0%, #9DB8C0 48%, #DFE0DA 100%)",
    energy: 0.3,
    visualPreset: "rain_glass",
    titleGenerator: () => "Window Song",
  },
  {
    id: "synth",
    label: { zh: "星汉灿烂", en: "Synth" },
    tags: ["synth pad", "moving bass", "night glow"],
    gradient: "linear-gradient(148deg, #8654C4 0%, #141E30 45%, #C85A28 100%)",
    energy: 0.7,
    visualPreset: "synth_glow",
    titleGenerator: () => "Little Signal",
  },
] as const;

export type VibeId = (typeof VIBE_PRESETS)[number]["id"];
export type VibePreset = (typeof VIBE_PRESETS)[number];
