import { mulberry32, hashString } from "@/lib/music/seeded-random";
import { buildEnglishTitleCandidates } from "@/lib/music/title-suggestions";
import type { Lang } from "@/lib/i18n/dict";
import type { CleanMelody } from "@/modules/shared/types";

/**
 * Randomized vibe prompts for the Magenta RealTime engine.
 *
 * Instead of the six fixed presets, every hum draws a fresh batch of three
 * vibes from these pools; "换一批" advances `batchIndex` for the next three.
 * Batches are deterministic per (seed, batchIndex) so a reroll never mutates
 * the batch it just showed, and consecutive batches never repeat a genre
 * until the whole pool has been walked once.
 */

export type VibePromptSpec = {
  vibeId: string;
  label: { zh: string; en: string };
  /** English style prompt fed to MusicCoCa. */
  prompt: string;
  tags: string[];
  visualFacets: {
    genre: string;
    mood: string;
    instrument: string;
    scene?: string;
    energy: number;
  };
  title: string;
  gradient: string;
  energy: number;
  visualPreset: string;
};

type GenreEntry = { en: string; zh: string; energy: number; title: string };
type MoodEntry = { en: string; zh: string; palette: [string, string, string] };
type InstrumentEntry = { en: string; zh: string };
type SceneEntry = { en: string; zh: string };

const GENRES: GenreEntry[] = [
  { en: "lo-fi hip hop", zh: "小楼昨夜", energy: 0.35, title: "Lo-fi Hip Hop" },
  { en: "synthwave", zh: "星河欲转", energy: 0.7, title: "Synthwave" },
  { en: "city pop", zh: "灯火阑珊", energy: 0.65, title: "City Pop" },
  { en: "bossa nova", zh: "清风徐来", energy: 0.45, title: "Bossa Nova" },
  { en: "ambient electronic", zh: "风烟俱净", energy: 0.25, title: "Ambient Electronica" },
  { en: "jazz fusion", zh: "轻拢慢捻", energy: 0.6, title: "Jazz Fusion" },
  { en: "dream pop instrumental", zh: "云想衣裳", energy: 0.45, title: "Dream Pop" },
  { en: "funk groove", zh: "春风得意", energy: 0.8, title: "Funk Groove" },
  { en: "disco", zh: "火树银花", energy: 0.85, title: "Disco" },
  { en: "deep house", zh: "星垂平野", energy: 0.75, title: "Deep House" },
  { en: "drum and bass", zh: "长风破浪", energy: 0.9, title: "Drum & Bass" },
  { en: "trip hop", zh: "烟波江上", energy: 0.4, title: "Trip Hop" },
  { en: "post-rock", zh: "苍山负雪", energy: 0.55, title: "Post-Rock" },
  { en: "neo-soul", zh: "似水流年", energy: 0.5, title: "Neo-Soul" },
  { en: "afrobeat", zh: "提携玉龙", energy: 0.8, title: "Afrobeat" },
  { en: "reggae dub", zh: "水光潋滟", energy: 0.55, title: "Reggae Dub" },
  { en: "flamenco guitar", zh: "胡笳十八", energy: 0.65, title: "Flamenco Guitar" },
  { en: "celtic folk", zh: "蒹葭苍苍", energy: 0.45, title: "Celtic Folk" },
  { en: "bluegrass", zh: "采薇采薇", energy: 0.7, title: "Bluegrass" },
  { en: "solo piano", zh: "疏影横斜", energy: 0.3, title: "Solo Piano" },
  { en: "baroque chamber strings", zh: "嘈嘈切切", energy: 0.5, title: "Baroque Chamber" },
  { en: "cinematic film score", zh: "江山如画", energy: 0.55, title: "Cinematic Score" },
  { en: "epic orchestral", zh: "气吞万里", energy: 0.75, title: "Epic Orchestral" },
  { en: "vaporwave", zh: "庄周梦蝶", energy: 0.4, title: "Vaporwave" },
  { en: "chillwave", zh: "月涌大江", energy: 0.45, title: "Chillwave" },
  { en: "UK garage", zh: "五陵年少", energy: 0.8, title: "UK Garage" },
  { en: "breakbeat", zh: "白雨跳珠", energy: 0.85, title: "Breakbeat" },
  { en: "surf rock", zh: "惊涛拍岸", energy: 0.7, title: "Surf Rock" },
  { en: "psychedelic rock", zh: "乱石穿空", energy: 0.65, title: "Psych Rock" },
  { en: "tango", zh: "两处闲愁", energy: 0.6, title: "Tango" },
  { en: "gamelan ensemble", zh: "大珠小珠", energy: 0.5, title: "Gamelan Ensemble" },
  { en: "koto and shakuhachi", zh: "空山新雨", energy: 0.35, title: "Koto & Shakuhachi" },
  { en: "guzheng meditation", zh: "素月流天", energy: 0.3, title: "Guzheng Meditation" },
  { en: "minimal techno", zh: "万籁俱寂", energy: 0.7, title: "Minimal Techno" },
  { en: "swing jazz", zh: "间关莺语", energy: 0.7, title: "Swing Jazz" },
  { en: "music box lullaby", zh: "如花美眷", energy: 0.25, title: "Music Box Lullaby" },
];

const MOODS: MoodEntry[] = [
  { en: "dreamy", zh: "如梦", palette: ["#B87FCC", "#8BAFC2", "#F0C7D8"] },
  { en: "melancholic", zh: "怅然", palette: ["#4E5D6E", "#8B96A6", "#D8D0C4"] },
  { en: "euphoric", zh: "雀跃", palette: ["#FF6E35", "#FFC94D", "#EE6AA0"] },
  { en: "mysterious", zh: "幽邃", palette: ["#16242C", "#4E7D96", "#8654C4"] },
  { en: "cozy", zh: "温存", palette: ["#FFBA5A", "#E8956B", "#B86B4C"] },
  { en: "nostalgic", zh: "怀旧", palette: ["#EDD9A3", "#C2956B", "#6A6472"] },
  { en: "triumphant", zh: "昂扬", palette: ["#F0663E", "#FFB23E", "#9B70D0"] },
  { en: "playful", zh: "俏皮", palette: ["#40E080", "#FFE040", "#40A0FF"] },
  { en: "brooding", zh: "低回", palette: ["#2A2118", "#6E4E3A", "#A6855C"] },
  { en: "serene", zh: "澄澈", palette: ["#9DB8C0", "#DFE0DA", "#5A8EAA"] },
  { en: "hypnotic", zh: "催眠", palette: ["#8654C4", "#141E30", "#C85A28"] },
  { en: "bittersweet", zh: "微苦", palette: ["#D88A9C", "#8BAFC2", "#EDD9A3"] },
  { en: "glowing", zh: "微光", palette: ["#FFD7A8", "#FF8A5C", "#C2719E"] },
  { en: "weightless", zh: "失重", palette: ["#A8C8E8", "#E8E2F4", "#7FA6CC"] },
  { en: "smoky", zh: "烟霭", palette: ["#5C5650", "#8C8780", "#3A3631"] },
  { en: "starlit", zh: "星夜", palette: ["#141E30", "#40A0FF", "#C0D8F0"] },
];

const INSTRUMENTS: InstrumentEntry[] = [
  { en: "warm Rhodes piano", zh: "电钢琴" },
  { en: "analog synth pads", zh: "模拟合成垫" },
  { en: "fingerpicked acoustic guitar", zh: "指弹木吉他" },
  { en: "muted trumpet", zh: "弱音小号" },
  { en: "upright bass", zh: "低音提琴" },
  { en: "vibraphone", zh: "颤音琴" },
  { en: "lush string section", zh: "弦乐组" },
  { en: "harp arpeggios", zh: "竖琴琶音" },
  { en: "marimba", zh: "马林巴" },
  { en: "deep 808 bass", zh: "808 低音" },
  { en: "tape-saturated drums", zh: "磁带鼓组" },
  { en: "brushed drums", zh: "鼓刷" },
  { en: "modular synth arpeggios", zh: "模块合成琶音" },
  { en: "church organ", zh: "管风琴" },
  { en: "accordion", zh: "手风琴" },
  { en: "steel drums", zh: "钢鼓" },
  { en: "kalimba", zh: "拇指琴" },
  { en: "music box", zh: "八音盒" },
  { en: "tenor saxophone", zh: "萨克斯" },
  { en: "slide guitar", zh: "滑棒吉他" },
];

const SCENES: SceneEntry[] = [
  { en: "with vinyl crackle", zh: "黑胶噪点" },
  { en: "with soft tape hiss", zh: "磁带嘶声" },
  { en: "for a midnight drive", zh: "午夜兜风" },
  { en: "on a rooftop at dusk", zh: "黄昏天台" },
  { en: "underwater and glowing", zh: "水下微光" },
  { en: "in winter morning light", zh: "冬日晨光" },
  { en: "at a summer night market", zh: "夏夜市集" },
  { en: "in a neon arcade", zh: "霓虹街机厅" },
  { en: "while rain taps the window", zh: "雨点敲窗" },
  { en: "drifting through fog", zh: "雾中漂浮" },
];

export function displayStyleLabelForGenre(genre: string, lang: Lang = "en"): string {
  const match = GENRES.find((entry) => normalized(entry.en) === normalized(genre));
  if (!match) return genre;
  return lang === "zh" ? match.zh : match.title;
}

const VISUAL_PRESETS_BY_ENERGY: Array<{ max: number; presets: string[] }> = [
  { max: 0.4, presets: ["rain_glass", "dust_room"] },
  { max: 0.62, presets: ["warm_particles", "end_credits"] },
  { max: 1.01, presets: ["confetti_pulse", "synth_glow"] },
];

function pickIndex(rng: () => number, length: number): number {
  return Math.floor(rng() * length) % length;
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function tempoHint(melody?: Pick<CleanMelody, "bpm">): string | null {
  if (!melody) return null;
  if (melody.bpm >= 120) return "fast tempo";
  if (melody.bpm >= 104) return "upbeat tempo";
  if (melody.bpm <= 72) return "slow tempo";
  return null;
}

function gradientFor(mood: MoodEntry, rng: () => number): string {
  const colors = shuffled(mood.palette, rng);
  return `linear-gradient(148deg, ${colors[0]} 0%, ${colors[1]} 48%, ${colors[2]} 100%)`;
}

function visualPresetFor(energy: number, rng: () => number): string {
  const bucket =
    VISUAL_PRESETS_BY_ENERGY.find((entry) => energy < entry.max) ??
    VISUAL_PRESETS_BY_ENERGY[VISUAL_PRESETS_BY_ENERGY.length - 1]!;
  return bucket.presets[pickIndex(rng, bucket.presets.length)]!;
}

/**
 * Build one deterministic batch of vibe prompts.
 *
 * Genres are drawn from a seed-shuffled ring so batch N+1 ("换一批") never
 * repeats a genre from batch N; moods/instruments/scenes are sampled per
 * vibe with their own seeded stream.
 */
export function createVibePromptBatch(options: {
  seed: string;
  batchIndex: number;
  count?: number;
  melody?: Pick<CleanMelody, "bpm" | "scale">;
}): VibePromptSpec[] {
  const count = options.count ?? 3;
  const genreOrder = shuffled(GENRES, mulberry32(hashString(`${options.seed}:genres`)));

  return Array.from({ length: count }, (_, slot) => {
    const genre = genreOrder[(options.batchIndex * count + slot) % genreOrder.length]!;
    const rng = mulberry32(
      hashString(`${options.seed}:${options.batchIndex}:${slot}:${genre.en}`),
    );
    const mood = MOODS[pickIndex(rng, MOODS.length)]!;
    const instrument = INSTRUMENTS[pickIndex(rng, INSTRUMENTS.length)]!;
    const scene = rng() < 0.5 ? SCENES[pickIndex(rng, SCENES.length)]! : null;

    const parts = [
      `${mood.en} ${genre.en}`,
      `with ${instrument.en}`,
      "clear instrumental lead melody",
      "no vocals",
    ];
    if (scene) parts.push(scene.en);
    const hint = tempoHint(options.melody);
    if (hint) parts.push(hint);
    if (options.melody?.scale === "minor") parts.push("in a minor key");

    const energy = Math.min(0.9, Math.max(0.25, genre.energy));
    const tags = [genre.en, mood.en, instrument.en];

    return {
      vibeId: `mgt-${hashString(`${options.seed}:${options.batchIndex}:${slot}`).toString(36)}`,
      label: { zh: genre.zh, en: genre.title },
      prompt: parts.join(", "),
      tags,
      visualFacets: {
        genre: genre.en,
        mood: mood.en,
        instrument: instrument.en,
        scene: scene?.en,
        energy,
      },
      title: buildEnglishTitleCandidates(
        {
          seed: `${options.seed}:${options.batchIndex}:${slot}:${genre.en}`,
          genre: genre.en,
          mood: mood.en,
          scene: scene?.en,
        },
        1,
      )[0]!,
      gradient: gradientFor(mood, rng),
      energy,
      visualPreset: visualPresetFor(energy, rng),
    };
  });
}

function normalized(value: string): string {
  return value.toLowerCase().trim();
}
