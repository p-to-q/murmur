import type { songs } from "@/lib/db/schema/songs";

type SongRow = typeof songs.$inferSelect;

export type DemoSong = Omit<SongRow, "mp3DataUrl"> & { mp3Url: string };

export const DEMO_SONG_IDS = ["demo-1", "demo-2", "demo-3"] as const;

export function isDemoSongId(id: string): boolean {
  return (DEMO_SONG_IDS as readonly string[]).includes(id);
}

export function getDemoSong(id: string): DemoSong | null {
  return DEMO_SONGS_MAP.get(id) ?? null;
}

export function getAllDemoSongs(): DemoSong[] {
  return [...DEMO_SONGS_MAP.values()];
}

const DEMO_SONGS_MAP = new Map<string, DemoSong>([
  [
    "demo-1",
    {
      id: "demo-1",
      userId: "local-creator",
      title: "Weightless DnB",
      vibe: "mgt-1swy7cv",
      vibeEn: "Weightless DnB",
      bpm: 80,
      keySignature: "C",
      scaleType: "major",
      duration: 10,
      parentSongId: null,
      rootSongId: "demo-1",
      lineageDepth: 0,
      sourceMelodyKind: "corrected",
      editCount: 0,
      editDepth: "fresh",
      mp3Url: "/demo/weightless-dnb.mp3",
      visualConfig: {
        preset: "confetti_pulse",
        artwork: {
          id: "hypermodern_void-commons-whistler-nocturne-black-gold-falling-rocket",
          crop: { x: 0.5, y: 0.48, scale: 1.06 },
          year: "1875",
          title: "Nocturne in Black and Gold: The Falling Rocket",
          artist: "James McNeill Whistler",
          bucket: "hypermodern_void",
          source: "commons",
          license: "Public Domain",
          palette: ["#314036", "#152219", "#243329", "#3E4D3D", "#646740"],
          imagePath: "/artworks/hypermodern_void/commons-whistler-nocturne-black-gold-falling-rocket.jpg",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Whistler-Nocturne_in_black_and_gold.jpg",
          renderTreatment: { grain: "light", intent: "background_field", contrast: "softened", cropFormat: "square", recommendedOverlay: 0.22 },
          backgroundImagePath: "/background_ready/hypermodern_void/commons-whistler-nocturne-black-gold-falling-rocket-bg.jpg",
        },
        gradient: "linear-gradient(148deg, #646740 0%, #314036 48%, #3E4D3D 100%)",
        pulseSource: "drums",
        visualFacets: { mood: "weightless", genre: "drum and bass", scene: "at a summer night market", energy: 0.9, instrument: "harp arpeggios" },
        particleDensity: 0.9,
      },
      arrangementState: {
        bass: { enabled: true, intensity: 0.55, instrument: "upright_bass", bassPattern: "walking", currentPattern: "walking", versionHistory: [], originalPattern: "walking" },
        drums: { enabled: true, intensity: 0.42, instrument: "brush_kit", drumsPattern: "soft", currentPattern: "soft", versionHistory: [], originalPattern: "soft" },
        chords: { enabled: true, chordsTag: "sunset", intensity: 0.55, instrument: "piano", currentPattern: "gen:sunset", versionHistory: [], originalPattern: "gen:sunset" },
        melody: { enabled: true, intensity: 0.78, instrument: "bell", currentPattern: "", versionHistory: [], originalPattern: "", melodyPitchSequence: [] },
        strings: { enabled: true, chordsTag: "sunset", intensity: 0.45, instrument: "soft_pad", currentPattern: "gen:sunset", versionHistory: [], originalPattern: "gen:sunset" },
        texture: { enabled: true, intensity: 0.32, instrument: "warm_air", texturePreset: "sunset", currentPattern: "tex:sunset", versionHistory: [], originalPattern: "tex:sunset" },
      },
      tags: ["drum and bass", "weightless", "harp arpeggios"],
      createdAt: new Date("2026-06-19T17:04:56.832Z"),
      updatedAt: new Date("2026-06-19T17:04:56.832Z"),
    },
  ],
  [
    "demo-2",
    {
      id: "demo-2",
      userId: "local-creator",
      title: "Dreamy Celtic",
      vibe: "mgt-1q1p53x",
      vibeEn: "Dreamy Celtic",
      bpm: 100,
      keySignature: "G",
      scaleType: "major",
      duration: 10,
      parentSongId: null,
      rootSongId: "demo-2",
      lineageDepth: 0,
      sourceMelodyKind: "corrected",
      editCount: 0,
      editDepth: "fresh",
      mp3Url: "/demo/dreamy-celtic.mp3",
      visualConfig: {
        preset: "warm_particles",
        artwork: {
          id: "pastoral_memory-met-436081",
          crop: { x: 0.5, y: 0.52, scale: 1.03 },
          year: "1863",
          title: "Landscape on a River",
          artist: "Charles-François Daubigny",
          bucket: "pastoral_memory",
          source: "met",
          license: "Public Domain",
          imagePath: "/artworks/pastoral_memory/met-436081-daubigny-landscape-on-a-river.jpg",
          sourceUrl: "https://www.metmuseum.org/art/collection/search/436081",
          renderTreatment: { grain: "light", intent: "background_field", contrast: "softened", cropFormat: "square", recommendedOverlay: 0.22 },
          backgroundImagePath: "/background_ready/pastoral_memory/met-436081-daubigny-landscape-on-a-river-bg.jpg",
        },
        gradient: "linear-gradient(148deg, #8BAFC2 0%, #F0C7D8 48%, #B87FCC 100%)",
        pulseSource: "melody",
        visualFacets: { mood: "dreamy", genre: "celtic folk", scene: "with vinyl crackle", energy: 0.45, instrument: "music box" },
        particleDensity: 0.45,
      },
      arrangementState: {
        bass: { enabled: true, intensity: 0.65, instrument: "synth_bass", bassPattern: "arpeggio", currentPattern: "arpeggio", versionHistory: [], originalPattern: "arpeggio" },
        drums: { enabled: true, intensity: 0.78, instrument: "dance_kit", drumsPattern: "four_hi", currentPattern: "four_hi", versionHistory: [], originalPattern: "four_hi" },
        chords: { enabled: true, chordsTag: "party", intensity: 0.6, instrument: "poly_synth", currentPattern: "gen:party", versionHistory: [], originalPattern: "gen:party" },
        melody: { enabled: true, intensity: 0.78, instrument: "arp_synth", currentPattern: "71 74 71 69 69 67 67 64 64 67 71 67 67", versionHistory: [], originalPattern: "71 74 71 69 69 67 67 64 64 67 71 67 67", melodyPitchSequence: [71, 74, 71, 69, 69, 67, 67, 64, 64, 67, 71, 67, 67] },
        strings: { enabled: true, chordsTag: "party", intensity: 0.42, instrument: "synth_pad", currentPattern: "gen:party", versionHistory: [], originalPattern: "gen:party" },
        texture: { enabled: true, intensity: 0.42, instrument: "modular_air", texturePreset: "party", currentPattern: "tex:party", versionHistory: [], originalPattern: "tex:party" },
      },
      tags: ["celtic folk", "dreamy", "music box"],
      createdAt: new Date("2026-06-17T23:32:41.212Z"),
      updatedAt: new Date("2026-06-17T23:32:41.212Z"),
    },
  ],
  [
    "demo-3",
    {
      id: "demo-3",
      userId: "local-creator",
      title: "Cozy Guzheng",
      vibe: "mgt-9wtkxb",
      vibeEn: "Cozy Guzheng",
      bpm: 94,
      keySignature: "F",
      scaleType: "major",
      duration: 10,
      parentSongId: null,
      rootSongId: "demo-3",
      lineageDepth: 0,
      sourceMelodyKind: "corrected",
      editCount: 0,
      editDepth: "fresh",
      mp3Url: "/demo/cozy-guzheng.mp3",
      visualConfig: {
        preset: "rain_glass",
        artwork: {
          id: "pastoral_memory-manual-monet-haystack-morning-snow-effect",
          crop: { x: 0.52, y: 0.55, scale: 1.05 },
          year: "1891",
          title: "Haystack, Morning Snow Effect",
          artist: "Claude Monet",
          bucket: "pastoral_memory",
          source: "manual",
          license: "Public Domain",
          imagePath: "/artworks/pastoral_memory/manual-monet-haystack-morning-snow-effect-1891.jpg",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Claude_Monet,_Haystack,_Morning_Snow_Effect_(Meule,_Effet_de_Neige,_le_Matin),_1891,_oil_on_canvas,_65_x_92_cm,_Museum_of_Fine_Arts,_Boston.jpg",
          renderTreatment: { grain: "light", intent: "background_field", contrast: "softened", cropFormat: "square", recommendedOverlay: 0.22 },
          backgroundImagePath: "/background_ready/pastoral_memory/manual-monet-haystack-morning-snow-effect-1891-bg.jpg",
        },
        gradient: "linear-gradient(148deg, #E8956B 0%, #FFBA5A 48%, #B86B4C 100%)",
        pulseSource: "melody",
        visualFacets: { mood: "cozy", genre: "guzheng meditation", scene: "for a midnight drive", energy: 0.3, instrument: "analog synth pads" },
        particleDensity: 0.3,
      },
      arrangementState: {
        bass: { enabled: true, intensity: 0.48, instrument: "upright_bass", bassPattern: "root_sustain", currentPattern: "root_sustain", versionHistory: [], originalPattern: "root_sustain" },
        drums: { enabled: true, intensity: 0.36, instrument: "lofi_kit", drumsPattern: "halftime", currentPattern: "halftime", versionHistory: [], originalPattern: "halftime" },
        chords: { enabled: true, chordsTag: "bedroom", intensity: 0.55, instrument: "piano", currentPattern: "gen:bedroom", versionHistory: [], originalPattern: "gen:bedroom" },
        melody: { enabled: true, intensity: 0.68, instrument: "piano", currentPattern: "65 67 69 72 69 65", versionHistory: [], originalPattern: "65 67 69 72 69 65", melodyPitchSequence: [65, 67, 69, 72, 69, 65] },
        strings: { enabled: true, chordsTag: "bedroom", intensity: 0.38, instrument: "vinyl_pad", currentPattern: "gen:bedroom", versionHistory: [], originalPattern: "gen:bedroom" },
        texture: { enabled: true, intensity: 0.3, instrument: "warm_air", texturePreset: "bedroom", currentPattern: "tex:bedroom", versionHistory: [], originalPattern: "tex:bedroom" },
      },
      tags: ["guzheng meditation", "cozy", "analog synth pads"],
      createdAt: new Date("2026-06-17T03:08:47.543Z"),
      updatedAt: new Date("2026-06-17T03:08:47.543Z"),
    },
  ],
]);
