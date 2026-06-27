export type FontPreloadAsset = {
  href: string;
  type: "font/woff2";
};

export type FontLoadTarget = {
  face: string;
  sample: string;
};

export const FONT_READY_TIMEOUT_MS = 3600;

export const FONT_PRELOAD_ASSETS: FontPreloadAsset[] = [
  {
    href: "/fonts/datatype/datatype-latin-wght-normal.woff2",
    type: "font/woff2",
  },
  {
    href: "/fonts/datatype/datatype-latin-ext-wght-normal.woff2",
    type: "font/woff2",
  },
];

const LATIN_UI_SAMPLE =
  "MURMUR Brewing Try a different hum New set hello@murmur.living";

const CHINESE_BRAND_SAMPLE =
  "脑海里的旋律，让它出来。按住白色圆圈开始哼唱。还没想好，随便哼几个音就行。什么调都可以，跑调也很好听。闭上眼睛，哼出此刻的心情。嗯嗯？Murmur 收集人类在散步、洗澡、拉大便时诞生的音乐灵感。点这个圆圈，先给它一点声音。起调藏歌我试听然后选你最喜欢的方向。";

export const BRAND_FONT_LOAD_TARGETS: FontLoadTarget[] = [
  {
    face: '400 1em "Murmur Datatype"',
    sample: LATIN_UI_SAMPLE,
  },
  {
    face: '600 1em "Murmur Datatype"',
    sample: LATIN_UI_SAMPLE,
  },
  {
    face: '300 1em "LXGW WenKai TC"',
    sample: CHINESE_BRAND_SAMPLE,
  },
  {
    face: '400 1em "LXGW WenKai TC"',
    sample: CHINESE_BRAND_SAMPLE,
  },
];
