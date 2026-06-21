import type { Lang } from "@/lib/i18n/dict";
import { hashString, mulberry32 } from "@/lib/music/seeded-random";
import type { VibeVersion, VisualFacets } from "@/modules/shared/types";

type TitleContext = {
  seed: string;
  genre?: string;
  mood?: string;
  scene?: string;
};

type EnglishTitleTemplate = (rng: () => number) => string;
type ZhTitleProfile = "soft" | "night" | "open" | "motion";
type ZhTitleTemplate = (rng: () => number, profile: ZhTitleProfile) => string;
type ZhTitlePools = {
  places: string[];
  images: string[];
  placeActions: string[];
  timeImages: string[];
  transitiveActions: string[];
  feelings: string[];
  imageActions: string[];
};

const ZH_CIPAI_SOFT = [
  "如梦令",
  "浣溪沙",
  "点绛唇",
  "采桑子",
  "清平乐",
  "忆江南",
  "木兰花",
  "满庭芳",
  "风入松",
  "少年游",
  "踏莎行",
  "后庭花",
  "淡黄柳",
  "惜红衣",
  "疏影",
  "暗香",
  "眉妩",
  "玉蝴蝶",
  "拜星",
  "踏月",
  "消息",
  "秋水",
  "连枝理",
];

const ZH_CIPAI_NIGHT = [
  "雨霖铃",
  "声声慢",
  "长相思",
  "相见欢",
  "临江仙",
  "西江月",
  "上西楼",
  "忆秦娥",
  "翠楼吟",
  "宴清都",
  "夜飞鹊",
  "拜星月慢",
  "烛影摇红",
  "长亭怨",
  "渡江云",
  "春云怨",
  "九张机",
  "长安女",
  "王孙信",
  "西笑吟",
];

const ZH_CIPAI_OPEN = [
  "望海潮",
  "定风波",
  "水调歌头",
  "八声甘州",
  "念奴娇",
  "永遇乐",
  "扬州慢",
  "大江乘",
  "大椿",
  "霜天晓角",
  "法曲献仙音",
  "凤凰台上忆吹箫",
  "霓裳中序第一",
  "石州慢",
  "瑞鹤仙",
  "太平令",
];

const ZH_CIPAI_MOTION = [
  "破阵子",
  "满江红",
  "贺新郎",
  "水龙吟",
  "鹊桥仙",
  "青玉案",
  "入塞",
  "行路难",
  "鹤冲天",
  "千秋岁引",
  "贺圣朝",
  "剑器近",
];

const ZH_BASE_PLACES = [
  "长安",
  "西楼",
  "西洲",
  "洛阳",
  "沈园",
  "广寒",
  "关山",
  "江南",
  "长亭",
  "西厢",
  "空山",
  "天涯",
  "青溪",
  "故园",
  "蓬山",
  "秦淮",
  "姑苏",
  "南浦",
  "兰舟",
  "玉门",
  "雁门",
  "琼楼",
];

const ZH_BASE_IMAGES = [
  "红纱",
  "青丝",
  "秋水",
  "孤舟",
  "海棠",
  "梨花",
  "棠梨",
  "玉笛",
  "琵琶",
  "云裳",
  "素月",
  "寒灯",
  "流萤",
  "飞花",
  "落雪",
  "清露",
  "春水",
  "晚钟",
  "桂影",
  "锦书",
  "朱弦",
  "残照",
  "疏影",
  "梅影",
  "烟波",
  "归鸿",
  "白露",
  "月华",
  "星河",
  "莲灯",
  "长风",
  "霜天",
  "山月",
  "松风",
  "花信",
  "桃叶",
  "云帆",
];

const ZH_BASE_PLACE_ACTIONS = [
  "听雨",
  "踏月",
  "寄雪",
  "问月",
  "入梦",
  "寻春",
  "折柳",
  "渡江",
  "看云",
  "待归",
  "照影",
  "吹梦",
  "乘月",
  "邀风",
  "问笛",
  "寻他",
];

const ZH_BASE_TIME_IMAGES = [
  "晚雨",
  "素月",
  "暮雪",
  "春朝",
  "秋夜",
  "清风",
  "三更",
  "一川",
  "小楼",
  "半窗",
  "满庭",
  "九重",
  "十年",
  "千秋",
  "一夕",
  "万里",
  "今宵",
  "此去",
  "旧年",
  "长夜",
];

const ZH_BASE_TRANSITIVE_ACTIONS = [
  "问",
  "照",
  "寄",
  "梦",
  "渡",
  "寻",
  "挽",
  "听",
  "入",
  "送",
];

const ZH_BASE_FEELINGS = [
  "归梦",
  "闲愁",
  "清欢",
  "相思",
  "长别",
  "芳信",
  "心事",
  "旧约",
  "春信",
  "别意",
  "梦痕",
  "轻寒",
  "未央",
  "归期",
  "故人",
  "初见",
  "离歌",
  "人间",
];

const ZH_BASE_IMAGE_ACTIONS = [
  "照影",
  "听雨",
  "问月",
  "入梦",
  "归舟",
  "落灯",
  "成歌",
  "寄北",
  "如初",
  "未央",
  "扶摇",
  "惊秋",
];

const ZH_NUMERIC_PHRASES = [
  "一纸春山",
  "半壶春水",
  "三生旧梦",
  "九张云锦",
  "万里归舟",
  "千秋一梦",
  "满庭芳信",
  "一川烟水",
  "半窗疏影",
  "十年灯火",
  "几度春风",
  "小楼听雨",
  "一叶兰舟",
  "两处闲愁",
];

const ZH_STORY_PHRASES = [
  "且问归期",
  "山海入梦",
  "风起故园",
  "月照归舟",
  "梦外长安",
  "云外清欢",
  "人间晚晴",
  "照见江南",
  "归舟向晚",
  "长风入怀",
  "花信未归",
  "旧梦成歌",
  "素月如初",
  "春水东流",
  "万里扶摇",
  "风月无边",
  "此去经年",
  "灯影阑珊",
  "青山如故",
  "不知归处",
  "明月来书",
  "烟波未老",
  "风住尘香",
];

const ZH_PROFILED_POOLS: Record<ZhTitleProfile, Omit<ZhTitlePools, "transitiveActions" | "imageActions">> = {
  soft: {
    places: ["江南", "春庭", "沈园", "青溪", "西楼", "兰舟", "小园"],
    images: ["梨花", "海棠", "清露", "花信", "疏影", "春水", "玉笛", "流萤"],
    placeActions: ["听雨", "寻春", "照影", "拈花", "待归"],
    timeImages: ["一晌", "半窗", "春朝", "小楼", "满庭"],
    feelings: ["清欢", "芳信", "轻寒", "初见", "心事"],
  },
  night: {
    places: ["长安", "西楼", "西洲", "秦淮", "长亭", "南浦", "故园"],
    images: ["寒灯", "素月", "落雪", "归鸿", "锦书", "白露", "残照"],
    placeActions: ["听雨", "寄北", "问月", "入梦", "待归"],
    timeImages: ["三更", "今宵", "昨夜", "长夜", "晚雨"],
    feelings: ["相思", "闲愁", "归期", "旧梦", "长别"],
  },
  open: {
    places: ["关山", "广寒", "玉门", "雁门", "天涯", "云梦", "琼楼", "沧海"],
    images: ["长风", "星河", "云帆", "山月", "松风", "烟波", "霜天", "落日"],
    placeActions: ["乘月", "渡江", "看云", "邀风", "望海"],
    timeImages: ["千秋", "万里", "一川", "九重", "明朝"],
    feelings: ["归梦", "未央", "人间", "故人", "春信"],
  },
  motion: {
    places: ["关山", "长安", "雁门", "玉门", "广陵", "神都"],
    images: ["长风", "红纱", "朱弦", "琵琶", "云裳", "飞花", "莲灯", "星河"],
    placeActions: ["踏月", "乘风", "渡江", "问笛", "寻他", "吹梦"],
    timeImages: ["千秋", "十年", "万里", "一夕", "九重"],
    feelings: ["离歌", "旧约", "人间", "归舟", "未央"],
  },
};

const ZH_FORBIDDEN_EXACT_TITLES = new Set([
  "牵丝戏",
  "赤伶",
  "青丝",
  "春庭雪",
  "烟雨行舟",
  "吹梦到西洲",
  "晚夜微雨问海棠",
  "千秋迭梦",
  "忘川彼岸",
  "九万字",
  "山有木兮",
  "关山酒",
  "广寒宫",
  "探窗",
  "不负人间",
  "莫问归期",
  "霜雪千年",
  "棠梨煎雪",
  "沈园外",
  "西厢寻他",
  "洛阳纸",
  "游山恋",
  "半壶纱",
  "美人画卷",
]);

const ZH_TITLE_TEMPLATES: ZhTitleTemplate[] = [
  (rng, profile) => pick(rng, zhCipaiFor(profile)),
  (rng, profile) => pick(rng, zhCipaiFor(profile)),
  (rng, profile) => {
    const pool = zhTitlePoolsFor(profile);
    return `${pick(rng, pool.places)}${pick(rng, pool.placeActions)}`;
  },
  (rng, profile) => {
    const pool = zhTitlePoolsFor(profile);
    return `${pick(rng, pool.timeImages)}${pick(rng, pool.transitiveActions)}${pick(rng, pool.images)}`;
  },
  (rng, profile) => {
    const pool = zhTitlePoolsFor(profile);
    return `${pick(rng, pool.timeImages)}${pick(rng, pool.feelings)}`;
  },
  (rng, profile) => {
    const pool = zhTitlePoolsFor(profile);
    return `${pick(rng, pool.images)}${pick(rng, pool.imageActions)}`;
  },
  (rng) => pick(rng, ZH_NUMERIC_PHRASES),
  (rng) => pick(rng, ZH_STORY_PHRASES),
  (rng, profile) => {
    const pool = zhTitlePoolsFor(profile);
    return `${pick(rng, pool.places)}${pick(rng, pool.images)}`;
  },
];

const MANY_PREFIXES = [
  "A Thousand",
  "A Hundred",
  "All the",
];

const MANY_IMAGES = [
  "Little Fires",
  "Blue Years",
  "Summer Stars",
  "Quiet Roses",
  "Silver Mornings",
  "Colorado Moons",
  "Skies We Remember",
];

const SINGULAR_PREFIXES = [
  "One More",
  "Another",
  "Only One",
  "Last",
  "First",
];

const SINGULAR_IMAGES = [
  "Little Fire",
  "Blue Year",
  "Summer Star",
  "Quiet Rose",
  "Silver Morning",
  "Midnight Guitar",
  "Colorado Moon",
  "Sky to Remember",
];

const ACTION_GROUPS = [
  {
    opener: "Look at",
    endings: ["the Sky Again", "the Moonlight", "the Fire We Started", "What the Rain Left"],
  },
  {
    opener: "Meet Me Under",
    endings: ["the Colorado Moon", "the Opera Lights", "the Summer Stars", "the Western Sky"],
  },
  {
    opener: "See You in",
    endings: ["September Rain", "the Morning", "Colorado", "the Last Light", "the Blue Room"],
  },
  {
    opener: "Wait for",
    endings: ["the Morning Rain", "the Stars to Come Back", "Only Time", "the Last Train"],
  },
  {
    opener: "Come Back to",
    endings: ["the Blue Room", "the Firelight", "Colorado", "the Old Guitar"],
  },
  {
    opener: "Stay with",
    endings: ["Me Until Morning", "the Music", "This Little Fire"],
  },
];

const HEART_LINES = [
  "My Heart Keeps Burning Softly",
  "My Heart Will Find You",
  "You Are My Quiet Morning",
  "We Did Not Lose the Fire",
  "This Song Will Be There for You",
  "The Sky Can Still Count the Stars",
  "Your Light Comes Back Again",
];

const DRAMATIC_NOUNS = [
  "The Phantom",
  "The Fire",
  "The Last Rose",
  "The Light",
  "The Ballad",
  "The Guitar",
  "The House",
  "The Echo",
];

const DRAMATIC_PLACES = [
  "Under Colorado",
  "After Midnight",
  "of the Western Sky",
  "Inside the Rain",
  "at the Opera House",
  "for You",
  "at the Edge of Summer",
  "by the River",
];

const MUSIC_FORMS = [
  "Rhapsody",
  "Nocturne",
  "Serenade",
  "Aubade",
  "Coda",
  "Interlude",
];

const MUSIC_SCENES = [
  "for You",
  "in Blue",
  "under Moonlight",
  "after the Fire",
  "on a Western Sky",
  "with a Red Red Rose",
  "for the Last Train",
];

const SOFT_ADJECTIVES = [
  "Young",
  "Golden",
  "Restless",
  "Lonely",
  "Bright",
  "Tender",
  "Wild",
];

const SOFT_STATES = [
  "Beautiful",
  "Almost Home",
  "Half Awake",
  "Still on Fire",
  "Full of Stars",
  "Lost in Summer",
];

const ENGLISH_TITLE_TEMPLATES: EnglishTitleTemplate[] = [
  (rng) => `${pick(rng, MANY_PREFIXES)} ${pick(rng, MANY_IMAGES)}`,
  (rng) => `${pick(rng, SINGULAR_PREFIXES)} ${pick(rng, SINGULAR_IMAGES)}`,
  (rng) => buildActionTitle(rng),
  (rng) => pick(rng, HEART_LINES),
  (rng) => `${pick(rng, DRAMATIC_NOUNS)} ${pick(rng, DRAMATIC_PLACES)}`,
  (rng) => `${pick(rng, MUSIC_FORMS)} ${pick(rng, MUSIC_SCENES)}`,
  (rng) => `${pick(rng, SOFT_ADJECTIVES)} and ${pick(rng, SOFT_STATES)}`,
];

export function buildEnglishTitleCandidates(context: TitleContext, count = 3): string[] {
  const rng = titleRng(context, "en");
  const templates = shuffled(ENGLISH_TITLE_TEMPLATES, rng);
  const titles: string[] = [];

  for (const template of templates) {
    addUnique(titles, template(rng));
    if (titles.length >= count) break;
  }

  while (titles.length < count) {
    addUnique(titles, ENGLISH_TITLE_TEMPLATES[titles.length % ENGLISH_TITLE_TEMPLATES.length]!(rng));
  }

  return titles.slice(0, count);
}

export function buildZhTitleCandidates(context: TitleContext, count = 3): string[] {
  const rng = titleRng(context, "zh");
  const profile = zhProfileFor(context);
  const templates = shuffled(ZH_TITLE_TEMPLATES, rng);
  const titles: string[] = [];

  for (const template of templates) {
    addZhTitle(titles, template(rng, profile));
    if (titles.length >= count) break;
  }

  for (let attempts = 0; titles.length < count && attempts < count * 20; attempts++) {
    const template = ZH_TITLE_TEMPLATES[attempts % ZH_TITLE_TEMPLATES.length]!;
    addZhTitle(titles, template(rng, profile));
  }

  for (const fallback of shuffled(zhCipaiFor(profile), rng)) {
    addZhTitle(titles, fallback);
    if (titles.length >= count) break;
  }

  return titles.slice(0, count);
}

export function buildVersionTitleSuggestions(version: VibeVersion, lang: Lang): string[] {
  const facets = version.visualConfig.visualFacets;
  const context: TitleContext = {
    seed: `${version.versionSeed}:${version.id}:${version.title}`,
    genre: firstString(facets?.genre, version.tags[0], version.vibe),
    mood: firstString(facets?.mood, version.tags[1]),
    scene: firstString(facets?.scene),
  };
  return lang === "zh"
    ? buildZhTitleCandidates(context)
    : buildEnglishTitleCandidates(context);
}

export function buildFallbackTitleSuggestions(lang: Lang): string[] {
  const context = { seed: "fallback-title-suggestions" };
  return lang === "zh"
    ? buildZhTitleCandidates(context)
    : buildEnglishTitleCandidates(context);
}

function zhProfileFor(context: Pick<VisualFacets, "genre" | "mood" | "scene">): ZhTitleProfile {
  const genre = normalized(context.genre);
  const mood = normalized(context.mood);
  const scene = normalized(context.scene);

  if (
    genre.includes("drum") ||
    genre.includes("breakbeat") ||
    genre.includes("garage") ||
    genre.includes("orchestral") ||
    mood.includes("triumphant") ||
    scene.includes("night market")
  ) {
    return "motion";
  }

  if (
    genre.includes("ambient") ||
    genre.includes("dream") ||
    genre.includes("piano") ||
    genre.includes("lullaby") ||
    mood.includes("serene") ||
    mood.includes("dreamy")
  ) {
    return "soft";
  }

  if (
    genre.includes("city") ||
    genre.includes("trip") ||
    genre.includes("house") ||
    genre.includes("synth") ||
    scene.includes("midnight") ||
    scene.includes("rain") ||
    scene.includes("neon")
  ) {
    return "night";
  }

  return "open";
}

function zhCipaiFor(profile: ZhTitleProfile): string[] {
  if (profile === "motion") return [...ZH_CIPAI_MOTION, ...ZH_CIPAI_OPEN, ...ZH_CIPAI_NIGHT];
  if (profile === "soft") return [...ZH_CIPAI_SOFT, ...ZH_CIPAI_NIGHT, ...ZH_CIPAI_OPEN];
  if (profile === "night") return [...ZH_CIPAI_NIGHT, ...ZH_CIPAI_SOFT, ...ZH_CIPAI_MOTION];
  return [...ZH_CIPAI_OPEN, ...ZH_CIPAI_MOTION, ...ZH_CIPAI_NIGHT];
}

function zhTitlePoolsFor(profile: ZhTitleProfile): ZhTitlePools {
  const profiled = ZH_PROFILED_POOLS[profile];
  return {
    places: [...profiled.places, ...ZH_BASE_PLACES],
    images: [...profiled.images, ...ZH_BASE_IMAGES],
    placeActions: [...profiled.placeActions, ...ZH_BASE_PLACE_ACTIONS],
    timeImages: [...profiled.timeImages, ...ZH_BASE_TIME_IMAGES],
    transitiveActions: ZH_BASE_TRANSITIVE_ACTIONS,
    feelings: [...profiled.feelings, ...ZH_BASE_FEELINGS],
    imageActions: ZH_BASE_IMAGE_ACTIONS,
  };
}

function titleRng(context: TitleContext, lang: Lang): () => number {
  return mulberry32(
    hashString(
      [
        "title",
        lang,
        context.seed,
        context.genre ?? "",
        context.mood ?? "",
        context.scene ?? "",
      ].join(":"),
    ),
  );
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

function buildActionTitle(rng: () => number): string {
  const group = pick(rng, ACTION_GROUPS);
  return `${group.opener} ${pick(rng, group.endings)}`;
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function addUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.push(value);
}

function addZhTitle(items: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  if (ZH_FORBIDDEN_EXACT_TITLES.has(trimmed)) return;
  addUnique(items, trimmed);
}

function firstString(...values: Array<string | undefined | null>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function normalized(value: string | undefined): string {
  return value?.toLowerCase().trim() ?? "";
}
