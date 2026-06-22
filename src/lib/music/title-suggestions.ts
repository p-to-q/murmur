import type { Lang } from "@/lib/i18n/dict";
import { hashString, mulberry32 } from "@/lib/music/seeded-random";
import type { VibeVersion, VisualFacets } from "@/modules/shared/types";

type TitleContext = {
  seed: string;
  genre?: string;
  mood?: string;
  scene?: string;
  batchIndex?: number;
};

type TitleProfile = "soft" | "night" | "open" | "motion";
type EnglishTitleTemplate = (rng: () => number, profile: TitleProfile) => string;
type ZhTitleTemplate = (rng: () => number, profile: TitleProfile) => string;

type EnglishTitlePools = {
  pluralImages: string[];
  singularImages: string[];
  lightImages: string[];
  places: string[];
  meetingPlaces: string[];
  actionEndings: string[];
  adjectives: string[];
  states: string[];
  dramaticNouns: string[];
  dramaticPlaces: string[];
  forms: string[];
  formScenes: string[];
};

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

const ZH_PROFILED_POOLS: Record<
  TitleProfile,
  Omit<ZhTitlePools, "transitiveActions" | "imageActions">
> = {
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

const EN_PLURAL_PREFIXES = ["A Thousand", "A Hundred", "All the"];
const EN_SINGULAR_PREFIXES = ["One More", "Another", "Last"];
const EN_COUNTING_VERBS = ["Counting", "Chasing", "Remembering"];
const EN_LIGHT_PREPOSITIONS = ["over", "in", "by"];

const EN_BASE_PLURAL_IMAGES = [
  "Little Fires",
  "Blue Years",
  "Summer Stars",
  "Quiet Roses",
  "Silver Mornings",
  "Colorado Moons",
  "Skies We Remember",
  "Neon Rivers",
  "Western Lights",
];

const EN_BASE_SINGULAR_IMAGES = [
  "Little Fire",
  "Blue Year",
  "Summer Star",
  "Quiet Rose",
  "Silver Morning",
  "Midnight Guitar",
  "Colorado Moon",
  "Last Train",
  "Old Guitar",
  "Red Red Rose",
];

const EN_BASE_LIGHT_IMAGES = [
  "Moonlight",
  "Firelight",
  "Starlight",
  "Morning Light",
  "Last Light",
  "Rainlight",
];

const EN_BASE_PLACES = [
  "Colorado",
  "the Western Sky",
  "the Blue Room",
  "September Rain",
  "the Old Garden",
  "the River",
  "the Edge of Summer",
];

const EN_BASE_PLACELESS_LIGHTS = [
  "Only Moonlight",
  "Only Time and Firelight",
  "Morning Light Comes Back",
  "The Last Light We Remember",
  "Moonlight for the Long Road",
];

const EN_BASE_MEETING_PLACES = [
  "the Colorado Moon",
  "the Opera Lights",
  "the Summer Stars",
  "the Western Sky",
  "the Old Marquee",
  "the Firelight",
  "the Last Light",
];

const EN_BASE_ACTION_ENDINGS = [
  "the Sky Again",
  "the Moonlight",
  "What the Rain Left",
  "the Stars to Come Back",
  "the Old Guitar",
  "the Morning",
  "the Firelight",
];

const EN_BASE_ADJECTIVES = [
  "Young",
  "Golden",
  "Restless",
  "Lonely",
  "Bright",
  "Tender",
  "Wild",
  "Blue",
];

const EN_BASE_STATES = [
  "Beautiful",
  "Almost Home",
  "Half Awake",
  "Still on Fire",
  "Full of Stars",
  "Lost in Summer",
  "Made of Rain",
];

const EN_BASE_DRAMATIC_NOUNS = [
  "Phantom",
  "Fire",
  "Last Rose",
  "Light",
  "Ballad",
  "Guitar",
  "House",
  "Echo",
];

const EN_BASE_DRAMATIC_PLACES = [
  "Colorado",
  "Midnight",
  "the Western Sky",
  "the Rain",
  "the Opera House",
  "the Edge of Summer",
  "the River",
  "the Blue Room",
];

const EN_BASE_FORMS = [
  "Rhapsody",
  "Nocturne",
  "Serenade",
  "Aubade",
  "Coda",
  "Interlude",
  "Ballad",
];

const EN_BASE_FORM_SCENES = [
  "for You",
  "in Blue",
  "under Moonlight",
  "after the Fire",
  "on a Western Sky",
  "with a Red Red Rose",
  "for the Last Train",
];

const EN_HEART_LINES = [
  "My Heart Will Find You",
  "You Are My Quiet Morning",
  "We Keep the Fire",
  "This Song Will Be There for You",
  "The Sky Still Counts the Stars",
  "Your Light Comes Back Again",
  "I Will Find You in the Morning",
];

const EN_PROFILED_POOLS: Record<TitleProfile, Partial<EnglishTitlePools>> = {
  soft: {
    pluralImages: ["Quiet Roses", "Silver Mornings", "Soft Windows", "Songs for You"],
    singularImages: ["Quiet Rose", "Silver Morning", "Little Window", "Soft Guitar"],
    lightImages: ["Only Moonlight", "Morning Light Comes Back"],
    places: ["the Blue Room", "the Old Garden", "the River", "September Rain"],
    meetingPlaces: ["the Quiet Rose", "the Old Garden Lights", "the Morning Sky"],
    adjectives: ["Tender", "Golden", "Young", "Bright"],
    states: ["Beautiful", "Almost Home", "Half Awake", "Made of Rain"],
  },
  night: {
    pluralImages: ["Midnight Fires", "Rainy Stars", "Blue Years", "Last Trains"],
    singularImages: ["Midnight Guitar", "Last Train", "Rainy Window", "Blue Room Light"],
    lightImages: ["Only Time and Firelight", "The Last Light We Remember"],
    places: ["Colorado", "the Blue Room", "September Rain", "the Opera House"],
    meetingPlaces: ["the Colorado Moon", "the Opera Lights", "the Midnight Sign"],
    adjectives: ["Lonely", "Blue", "Restless", "Young"],
    states: ["Half Awake", "Still on Fire", "Lost in Summer", "Almost Home"],
  },
  open: {
    pluralImages: ["Western Lights", "Colorado Moons", "Skies We Remember", "Silver Roads"],
    singularImages: ["Western Sky", "Colorado Moon", "Long Road", "Morning Fire"],
    lightImages: ["Moonlight for the Long Road", "The Last Light We Remember"],
    places: ["Colorado", "the Western Sky", "the Edge of Summer", "the River"],
    meetingPlaces: ["the Western Sky", "the Colorado Moon", "the Summer Stars"],
    adjectives: ["Golden", "Wild", "Bright", "Restless"],
    states: ["Full of Stars", "Still on Fire", "Almost Home", "Beautiful"],
  },
  motion: {
    pluralImages: ["Little Fires", "Neon Rivers", "Summer Stars", "Last Trains"],
    singularImages: ["Little Fire", "Neon Street", "Last Train", "Old Guitar"],
    lightImages: ["Morning Light Comes Back", "The Last Light We Remember"],
    places: ["the Western Sky", "the Last Train", "the Firelight", "the Opera House"],
    meetingPlaces: ["the Neon Sign", "the Last Train Lights", "the Firelight"],
    adjectives: ["Wild", "Restless", "Bright", "Golden"],
    states: ["Still on Fire", "Full of Stars", "Lost in Summer", "Almost Home"],
  },
};

const EN_FORBIDDEN_EXACT_TITLES = new Set([
  "A Thousand Years",
  "Counting Stars",
  "Young and Beautiful",
  "Only Time",
  "Moonlight on Colorado",
  "A Red Red Rose",
  "See You Again",
  "You Are My Sunshine",
  "The Phantom of the Opera",
  "My Heart Will Go On",
  "I'll Be There for You",
  "We Didn't Start the Fire",
]);

const ENGLISH_TITLE_TEMPLATES: EnglishTitleTemplate[] = [
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return `${pick(rng, EN_PLURAL_PREFIXES)} ${pick(rng, pool.pluralImages)}`;
  },
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return `${pick(rng, EN_SINGULAR_PREFIXES)} ${pick(rng, pool.singularImages)}`;
  },
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return `${pick(rng, EN_COUNTING_VERBS)} ${pick(rng, pool.pluralImages)}`;
  },
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return `${pick(rng, pool.adjectives)} and ${pick(rng, pool.states)}`;
  },
  (rng) => pick(rng, EN_HEART_LINES),
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return `Look at ${pick(rng, pool.actionEndings)}`;
  },
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return `Meet Me Under ${pick(rng, pool.meetingPlaces)}`;
  },
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return `The ${pick(rng, pool.dramaticNouns)} of ${pick(rng, pool.dramaticPlaces)}`;
  },
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return `${pick(rng, pool.forms)} ${pick(rng, pool.formScenes)}`;
  },
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return pick(rng, pool.lightImages);
  },
  (rng, profile) => {
    const pool = englishTitlePoolsFor(profile);
    return `${pick(rng, EN_BASE_LIGHT_IMAGES)} ${pick(rng, EN_LIGHT_PREPOSITIONS)} ${pick(rng, pool.places)}`;
  },
];

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

export function buildEnglishTitleCandidates(context: TitleContext, count = 3): string[] {
  const rng = titleRng(context, "en");
  const profile = titleProfileFor(context);
  const templates = shuffled(ENGLISH_TITLE_TEMPLATES, rng);
  const titles: string[] = [];

  for (const template of templates) {
    addEnglishTitle(titles, template(rng, profile));
    if (titles.length >= count) break;
  }

  for (let attempts = 0; titles.length < count && attempts < count * 20; attempts++) {
    const template = ENGLISH_TITLE_TEMPLATES[attempts % ENGLISH_TITLE_TEMPLATES.length]!;
    addEnglishTitle(titles, template(rng, profile));
  }

  return titles.slice(0, count);
}

export function buildZhTitleCandidates(context: TitleContext, count = 3): string[] {
  const rng = titleRng(context, "zh");
  const profile = titleProfileFor(context);
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
  return buildVersionTitleSuggestionBatch(version, lang);
}

export function buildVersionTitleSuggestionBatch(
  version: VibeVersion,
  lang: Lang,
  batchIndex = 0,
): string[] {
  const facets = version.visualConfig.visualFacets;
  const context: TitleContext = {
    seed: `${version.versionSeed}:${version.id}:${version.title}`,
    genre: firstString(facets?.genre, version.tags[0], version.vibe),
    mood: firstString(facets?.mood, version.tags[1]),
    scene: firstString(facets?.scene),
    batchIndex,
  };
  return buildLocalizedTitleCandidates(context, lang);
}

export function buildFallbackTitleSuggestions(lang: Lang): string[] {
  return buildFallbackTitleSuggestionBatch(lang);
}

export function buildFallbackTitleSuggestionBatch(lang: Lang, batchIndex = 0): string[] {
  const context = { seed: "fallback-title-suggestions", batchIndex };
  return buildLocalizedTitleCandidates(context, lang);
}

function buildLocalizedTitleCandidates(context: TitleContext, lang: Lang, count = 3): string[] {
  if (lang === "zh") {
    const zhCount = Math.max(0, count - 1);
    return [
      ...buildZhTitleCandidates(context, zhCount),
      ...buildEnglishTitleCandidates(context, count - zhCount),
    ].slice(0, count);
  }

  return buildEnglishTitleCandidates(context, count);
}

function titleProfileFor(context: Pick<VisualFacets, "genre" | "mood" | "scene">): TitleProfile {
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

function zhCipaiFor(profile: TitleProfile): string[] {
  if (profile === "motion") return [...ZH_CIPAI_MOTION, ...ZH_CIPAI_OPEN, ...ZH_CIPAI_NIGHT];
  if (profile === "soft") return [...ZH_CIPAI_SOFT, ...ZH_CIPAI_NIGHT, ...ZH_CIPAI_OPEN];
  if (profile === "night") return [...ZH_CIPAI_NIGHT, ...ZH_CIPAI_SOFT, ...ZH_CIPAI_MOTION];
  return [...ZH_CIPAI_OPEN, ...ZH_CIPAI_MOTION, ...ZH_CIPAI_NIGHT];
}

function zhTitlePoolsFor(profile: TitleProfile): ZhTitlePools {
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

function englishTitlePoolsFor(profile: TitleProfile): EnglishTitlePools {
  const profiled = EN_PROFILED_POOLS[profile];
  return {
    pluralImages: [...(profiled.pluralImages ?? []), ...EN_BASE_PLURAL_IMAGES],
    singularImages: [...(profiled.singularImages ?? []), ...EN_BASE_SINGULAR_IMAGES],
    lightImages: [...(profiled.lightImages ?? []), ...EN_BASE_PLACELESS_LIGHTS],
    places: [...(profiled.places ?? []), ...EN_BASE_PLACES],
    meetingPlaces: [...(profiled.meetingPlaces ?? []), ...EN_BASE_MEETING_PLACES],
    actionEndings: [...(profiled.actionEndings ?? []), ...EN_BASE_ACTION_ENDINGS],
    adjectives: [...(profiled.adjectives ?? []), ...EN_BASE_ADJECTIVES],
    states: [...(profiled.states ?? []), ...EN_BASE_STATES],
    dramaticNouns: [...(profiled.dramaticNouns ?? []), ...EN_BASE_DRAMATIC_NOUNS],
    dramaticPlaces: [...(profiled.dramaticPlaces ?? []), ...EN_BASE_DRAMATIC_PLACES],
    forms: [...(profiled.forms ?? []), ...EN_BASE_FORMS],
    formScenes: [...(profiled.formScenes ?? []), ...EN_BASE_FORM_SCENES],
  };
}

function titleRng(context: TitleContext, lang: Lang): () => number {
  return mulberry32(hashString(titleSeedFor(context, lang)));
}

function titleSeedFor(context: TitleContext, lang: Lang): string {
  return [
    "title",
    lang,
    context.seed,
    context.genre ?? "",
    context.mood ?? "",
    context.scene ?? "",
    context.batchIndex ?? 0,
  ].join(":");
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
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

function addEnglishTitle(items: string[], value: string): void {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return;
  if (EN_FORBIDDEN_EXACT_TITLES.has(trimmed)) return;
  addUnique(items, trimmed);
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
