/**
 * MURMUR Radio Station Registry
 * "fixture" = Tone.js synth (zero network, always works)
 * "live"    = real internet radio stream (SomaFM or similar)
 *
 * SomaFM stream format: https://ice[1-6].somafm.com/[channel]-128-mp3
 * fallbackUrl is a secondary ice server to try if primary fails.
 */

export type StationKind = "fixture" | "live";

export interface RadioStation {
  id: string;
  name: string;
  tagline: string;
  kind: StationKind;
  vibeId: string;                  // maps to VIBE_PRESETS id
  streamUrl?: string;              // primary stream (live only)
  fallbackUrl?: string;            // secondary stream (live only)
  gradient: string;                // visual gradient
  tags: string[];
  listenerCount?: number;          // approx active listeners (for social proof)
}

export const RADIO_STATIONS: RadioStation[] = [
  // ── Fixture stations (Tone.js, zero network) ─────────────────────────
  {
    id: "fixture-sunset",
    name: "黄昏 Demo",
    tagline: "你的哼唱 · 黄昏版本",
    kind: "fixture",
    vibeId: "sunset",
    gradient: "linear-gradient(135deg, #F4C87A, #E9A06D 45%, #C9B6E4)",
    tags: ["warm piano", "soft drums", "demo"],
  },
  {
    id: "fixture-bedroom",
    name: "卧室 Demo",
    tagline: "你的哼唱 · 卧室版本",
    kind: "fixture",
    vibeId: "bedroom",
    gradient: "linear-gradient(135deg, #FFF0D6, #A7B8C8 60%, #8B8680)",
    tags: ["lo-fi", "quiet bass", "demo"],
  },
  {
    id: "fixture-cinematic",
    name: "电影 Demo",
    tagline: "你的哼唱 · 电影版本",
    kind: "fixture",
    vibeId: "cinematic",
    gradient: "linear-gradient(135deg, #22303A, #A7B8C8, #F7F3EA)",
    tags: ["strings", "slow pulse", "demo"],
  },

  // ── Live stations: SomaFM ────────────────────────────────────────────
  {
    id: "somafm-groovesalad",
    name: "Groove Salad",
    tagline: "Ambient / downtempo beats · SomaFM",
    kind: "live",
    vibeId: "bedroom",
    streamUrl: "https://ice6.somafm.com/groovesalad-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/groovesalad-128-mp3",
    gradient: "linear-gradient(135deg, #FFF0D6, #A7B8C8 60%, #8B8680)",
    tags: ["ambient", "downtempo", "SomaFM"],
    listenerCount: 1400,
  },
  {
    id: "somafm-dronezone",
    name: "Drone Zone",
    tagline: "Atmospheric textures · SomaFM",
    kind: "live",
    vibeId: "cinematic",
    streamUrl: "https://ice6.somafm.com/dronezone-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/dronezone-128-mp3",
    gradient: "linear-gradient(135deg, #22303A, #A7B8C8, #F7F3EA)",
    tags: ["drone", "atmospheric", "SomaFM"],
    listenerCount: 900,
  },
  {
    id: "somafm-deepspaceone",
    name: "Deep Space One",
    tagline: "Deep ambient electronic · SomaFM",
    kind: "live",
    vibeId: "cinematic",
    streamUrl: "https://ice6.somafm.com/deepspaceone-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/deepspaceone-128-mp3",
    gradient: "linear-gradient(135deg, #1a2535, #3a5068, #F7F3EA)",
    tags: ["space", "experimental", "SomaFM"],
    listenerCount: 370,
  },
  {
    id: "somafm-spacestation",
    name: "Space Station Soma",
    tagline: "Spaced-out ambient electronica · SomaFM",
    kind: "live",
    vibeId: "synth",
    streamUrl: "https://ice6.somafm.com/spacestation-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/spacestation-128-mp3",
    gradient: "linear-gradient(135deg, #C9B6E4, #22303A, #E9A06D)",
    tags: ["electronica", "ambient", "SomaFM"],
    listenerCount: 250,
  },
  {
    id: "somafm-groovesaladclassic",
    name: "Groove Salad Classic",
    tagline: "Classic downtempo 2000s · SomaFM",
    kind: "live",
    vibeId: "sunset",
    streamUrl: "https://ice6.somafm.com/gsclassic-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/gsclassic-128-mp3",
    gradient: "linear-gradient(135deg, #F4C87A, #E9A06D 45%, #C9B6E4)",
    tags: ["classic", "downtempo", "SomaFM"],
    listenerCount: 220,
  },
  {
    id: "somafm-lush",
    name: "Lush",
    tagline: "Mellow female vocals · SomaFM",
    kind: "live",
    vibeId: "bedroom",
    streamUrl: "https://ice6.somafm.com/lush-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/lush-128-mp3",
    gradient: "linear-gradient(135deg, #F7C5CC, #FFF0D6, #C9B6E4)",
    tags: ["vocals", "mellow", "SomaFM"],
    listenerCount: 190,
  },
  {
    id: "somafm-synphaera",
    name: "Synphaera Radio",
    tagline: "Modern electronic ambient · SomaFM",
    kind: "live",
    vibeId: "synth",
    streamUrl: "https://ice6.somafm.com/synphaera-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/synphaera-128-mp3",
    gradient: "linear-gradient(135deg, #9B8EC4, #22303A, #A7B8C8)",
    tags: ["electronic", "space", "SomaFM"],
    listenerCount: 180,
  },
  {
    id: "somafm-beatblender",
    name: "Beat Blender",
    tagline: "Deep house / downtempo late night · SomaFM",
    kind: "live",
    vibeId: "party",
    streamUrl: "https://ice6.somafm.com/beatblender-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/beatblender-128-mp3",
    gradient: "linear-gradient(135deg, #E9A06D, #F7C5CC, #C9B6E4)",
    tags: ["deep house", "late night", "SomaFM"],
    listenerCount: 100,
  },
  {
    id: "somafm-thetrip",
    name: "The Trip",
    tagline: "Progressive house · trance · SomaFM",
    kind: "live",
    vibeId: "synth",
    streamUrl: "https://ice6.somafm.com/thetrip-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/thetrip-128-mp3",
    gradient: "linear-gradient(135deg, #C9B6E4, #3a2060, #E9A06D)",
    tags: ["trance", "progressive", "SomaFM"],
    listenerCount: 110,
  },
  {
    id: "somafm-vaporwaves",
    name: "Vaporwaves",
    tagline: "Vaporwave / chillwave / future funk · SomaFM",
    kind: "live",
    vibeId: "synth",
    streamUrl: "https://ice6.somafm.com/vaporwaves-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/vaporwaves-128-mp3",
    gradient: "linear-gradient(135deg, #ff9de2, #a78bfa, #38bdf8)",
    tags: ["vaporwave", "chillwave", "SomaFM"],
    listenerCount: 130,
  },
  {
    id: "somafm-bomsalsa",
    name: "Bossa Beyond",
    tagline: "Bossa nova and beyond · SomaFM",
    kind: "live",
    vibeId: "sunset",
    streamUrl: "https://ice6.somafm.com/bossabeyond-128-mp3",
    fallbackUrl: "https://ice2.somafm.com/bossabeyond-128-mp3",
    gradient: "linear-gradient(135deg, #F4C87A, #e07d4f, #c4a882)",
    tags: ["bossa nova", "jazz", "SomaFM"],
    listenerCount: 85,
  },
  {
    id: "lofi-play",
    name: "Lofi Radio",
    tagline: "24/7 lofi hip hop · chill beats",
    kind: "live",
    vibeId: "bedroom",
    streamUrl: "https://play.streamafrica.net/lofiradio",
    gradient: "linear-gradient(135deg, #FFF0D6, #A7B8C8 60%, #8B8680)",
    tags: ["lofi", "hip hop", "chill"],
    listenerCount: 200,
  },
];

// ── Helper functions ──────────────────────────────────────────────────

export function stationsByVibe(vibeId: string): RadioStation[] {
  return RADIO_STATIONS.filter((s) => s.vibeId === vibeId);
}

export function liveStations(): RadioStation[] {
  return RADIO_STATIONS.filter((s) => s.kind === "live");
}

export function fixtureStations(): RadioStation[] {
  return RADIO_STATIONS.filter((s) => s.kind === "fixture");
}

export function stationById(id: string): RadioStation | undefined {
  return RADIO_STATIONS.find((s) => s.id === id);
}

export function stationsForPicker(): RadioStation[] {
  // Live first, sorted by listenerCount desc, then fixtures at the end
  const live = liveStations().sort(
    (a, b) => (b.listenerCount ?? 0) - (a.listenerCount ?? 0)
  );
  const fixture = fixtureStations();
  return [...live, ...fixture];
}
