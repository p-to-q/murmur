import { mulberry32, hashString } from "@/lib/music/seeded-random";
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
  { en: "lo-fi hip hop", zh: "慵懒节拍", energy: 0.35, title: "Lo-fi" },
  { en: "synthwave", zh: "霓虹合成", energy: 0.7, title: "Synthwave" },
  { en: "city pop", zh: "都市流行", energy: 0.65, title: "City Pop" },
  { en: "bossa nova", zh: "巴萨诺瓦", energy: 0.45, title: "Bossa" },
  { en: "ambient electronic", zh: "氛围电子", energy: 0.25, title: "Ambient" },
  { en: "jazz fusion", zh: "爵士融合", energy: 0.6, title: "Fusion" },
  { en: "dream pop instrumental", zh: "梦境流行", energy: 0.45, title: "Dream Pop" },
  { en: "funk groove", zh: "放克律动", energy: 0.8, title: "Funk" },
  { en: "disco", zh: "迪斯科", energy: 0.85, title: "Disco" },
  { en: "deep house", zh: "深邃浩室", energy: 0.75, title: "Deep House" },
  { en: "drum and bass", zh: "鼓打贝斯", energy: 0.9, title: "DnB" },
  { en: "trip hop", zh: "迷幻节拍", energy: 0.4, title: "Trip Hop" },
  { en: "post-rock", zh: "后摇滚", energy: 0.55, title: "Post-rock" },
  { en: "neo-soul", zh: "新灵魂乐", energy: 0.5, title: "Neo-soul" },
  { en: "afrobeat", zh: "非洲节拍", energy: 0.8, title: "Afrobeat" },
  { en: "reggae dub", zh: "雷鬼回响", energy: 0.55, title: "Dub" },
  { en: "flamenco guitar", zh: "弗拉门戈", energy: 0.65, title: "Flamenco" },
  { en: "celtic folk", zh: "凯尔特民谣", energy: 0.45, title: "Celtic" },
  { en: "bluegrass", zh: "蓝草乡村", energy: 0.7, title: "Bluegrass" },
  { en: "solo piano", zh: "独白钢琴", energy: 0.3, title: "Piano" },
  { en: "baroque chamber strings", zh: "巴洛克弦乐", energy: 0.5, title: "Baroque" },
  { en: "cinematic film score", zh: "电影配乐", energy: 0.55, title: "Score" },
  { en: "epic orchestral", zh: "史诗管弦", energy: 0.75, title: "Orchestral" },
  { en: "vaporwave", zh: "蒸汽波", energy: 0.4, title: "Vaporwave" },
  { en: "chillwave", zh: "冷感浪潮", energy: 0.45, title: "Chillwave" },
  { en: "UK garage", zh: "英伦车库", energy: 0.8, title: "Garage" },
  { en: "breakbeat", zh: "碎拍", energy: 0.85, title: "Breakbeat" },
  { en: "surf rock", zh: "冲浪摇滚", energy: 0.7, title: "Surf Rock" },
  { en: "psychedelic rock", zh: "迷幻摇滚", energy: 0.65, title: "Psych Rock" },
  { en: "tango", zh: "探戈", energy: 0.6, title: "Tango" },
  { en: "gamelan ensemble", zh: "甘美兰", energy: 0.5, title: "Gamelan" },
  { en: "koto and shakuhachi", zh: "和风筝笛", energy: 0.35, title: "Koto" },
  { en: "guzheng meditation", zh: "古筝冥想", energy: 0.3, title: "Guzheng" },
  { en: "minimal techno", zh: "极简铁克诺", energy: 0.7, title: "Techno" },
  { en: "swing jazz", zh: "摇摆爵士", energy: 0.7, title: "Swing" },
  { en: "music box lullaby", zh: "八音盒摇篮", energy: 0.25, title: "Lullaby" },
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

    const parts = [`${mood.en} ${genre.en}`, `with ${instrument.en}`];
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
      title: `${capitalize(mood.en)} ${genre.title}`,
      gradient: gradientFor(mood, rng),
      energy,
      visualPreset: visualPresetFor(energy, rng),
    };
  });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
