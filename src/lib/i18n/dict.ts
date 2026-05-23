// Translation dictionary. Keys are dotted strings, values are { zh, en }.
// Add new keys here as the UI grows. Missing keys fall back to the key itself.

export const DICT = {
  // ── Brand / global ──────────────────────────────────────────────────
  "app.title":         { zh: "MURMUR",                                en: "MURMUR" },
  "app.tagline":       { zh: "把哼唱变成一张可分享的小歌卡片",         en: "Turn a hum into a sharable little song" },

  // ── Bottom nav ──────────────────────────────────────────────────────
  "nav.hum":           { zh: "哼唱",       en: "Hum" },
  "nav.gallery":       { zh: "灵感集",     en: "Gallery" },
  "nav.me":            { zh: "我的",       en: "Me" },

  // ── HumScreen ───────────────────────────────────────────────────────
  "hum.brand.tagline": { zh: "MURMUR",     en: "MURMUR" },
  "hum.eyebrow":       { zh: "从一句哼唱开始", en: "Start with a hum" },
  "hum.start":         { zh: "开始录音",   en: "Start recording" },
  "hum.stop":          { zh: "停止录音",   en: "Stop recording" },
  "hum.idle.headline": { zh: "哼一句。",   en: "Hum a tune." },
  "hum.idle.sub":      { zh: "Murmur 会把它编成一首小歌。", en: "Murmur will weave it into a small song." },
  "hum.idle.hint":     { zh: "最长 15 秒，随时点停",   en: "Up to 15 seconds — tap to stop" },
  "hum.recording":     { zh: "正在听…",    en: "Listening…" },
  "hum.tap_stop":      { zh: "点击方块停止", en: "Tap the square to stop" },
  "hum.proc.wait":     { zh: "稍等一下…",  en: "Hang tight…" },
  "hum.proc.listening":{ zh: "正在听你的旋律…",  en: "Listening to your melody…" },
  "hum.proc.polishing":{ zh: "整理成更顺的版本…", en: "Polishing it into a cleaner take…" },
  "hum.proc.adding_drums": { zh: "长出鼓、贝斯和弦乐…", en: "Growing drums, bass and strings…" },
  "hum.proc.three_vibes":  { zh: "生成三种感觉…",    en: "Generating three vibes…" },
  "hum.mic.title":     { zh: "无法访问麦克风",    en: "Microphone not available" },
  "hum.mic.detail":    { zh: "可能是浏览器权限被拒，或在不支持录音的环境里。可以用示例旋律走完整流程，或开放权限后重试。", en: "Mic permission may be denied or unavailable here. Try the example melody to see the whole flow, or grant access and retry." },
  "hum.mic.cta_example": { zh: "用示例旋律体验完整流程", en: "Try with an example melody" },
  "hum.mic.cta_retry":   { zh: "重试麦克风",            en: "Retry microphone" },

  // ── VersionCards ────────────────────────────────────────────────────
  "cards.eyebrow":    { zh: "你的旋律长出了", en: "Your melody grew into" },
  "cards.headline":   { zh: "3 个方向",       en: "3 directions" },
  "cards.preview":    { zh: "试听",           en: "Preview" },
  "cards.choose":     { zh: "选这个",         en: "Pick" },
  "cards.redo":       { zh: "重新哼唱",       en: "Hum again" },
  "cards.play_error": { zh: "播放失败，请重试", en: "Playback failed — please retry" },

  // ── Studio (Vibe 氛围台) ───────────────────────────────────────────
  "studio.back":           { zh: "返回",       en: "Back" },
  "studio.restore":        { zh: "恢复原始",   en: "Restore original" },
  "studio.restore_toast":  { zh: "已恢复到原始版本", en: "Restored to the original version" },
  "studio.mixer":          { zh: "混音",        en: "Mixer" },
  "studio.mixer.help":     { zh: "点图标开/关该轨道，拖进度条调音量，拉到 0 = 静音", en: "Tap an icon to toggle a track, drag the slider for volume, 0 = mute" },
  "studio.scenes":         { zh: "场景",        en: "Scenes" },
  "studio.prompt.title":   { zh: "一句话修改",  en: "Tweak in one sentence" },
  "studio.prompt.placeholder": { zh: "让它更温暖、鼓少一点、加点贝斯…", en: "Make it warmer, fewer drums, add some bass…" },
  "studio.prompt.cta":     { zh: "改",          en: "Apply" },
  "studio.prompt.unknown": { zh: "没识别这条指令，试试下面的旋钮", en: "Didn't catch that — try the knobs below" },
  "studio.prompt.applied": { zh: "已应用",      en: "Applied" },
  "studio.save":           { zh: "存入灵感集",  en: "Save to Gallery" },
  "studio.saving":         { zh: "保存中…",     en: "Saving…" },
  "studio.save_ok":        { zh: "已保存到灵感集", en: "Saved to your Gallery" },
  "studio.save_err":       { zh: "保存失败，请重试", en: "Save failed — please retry" },
  "studio.empty":          { zh: "还没有选定版本", en: "No version selected yet" },
  "studio.empty.cta":      { zh: "去哼一段旋律", en: "Hum a melody" },
  "studio.rendering":      { zh: "正在渲染音频和分享页…", en: "Rendering audio + share page…" },

  // ── Track labels ───────────────────────────────────────────────────
  "track.melody":  { zh: "主旋律", en: "Melody" },
  "track.chords":  { zh: "和弦",   en: "Chords" },
  "track.strings": { zh: "弦乐",   en: "Strings" },
  "track.bass":    { zh: "贝斯",   en: "Bass" },
  "track.drums":   { zh: "鼓",     en: "Drums" },
  "track.texture": { zh: "氛围垫", en: "Texture" },

  // ── Scene presets ──────────────────────────────────────────────────
  "scene.warm.label":       { zh: "更温暖",     en: "Warmer" },
  "scene.warm.desc":        { zh: "和弦 + 氛围 ↑", en: "Chords + air ↑" },
  "scene.cinematic.label":  { zh: "电影感",     en: "Cinematic" },
  "scene.cinematic.desc":   { zh: "弦乐 ↑ 鼓 ↓", en: "Strings ↑ drums ↓" },
  "scene.party.label":      { zh: "派对",       en: "Party" },
  "scene.party.desc":       { zh: "鼓 + 贝斯 ↑", en: "Drums + bass ↑" },
  "scene.minimal.label":    { zh: "极简",       en: "Minimal" },
  "scene.minimal.desc":     { zh: "只留旋律 + 贝斯", en: "Melody + bass only" },
  "scene.lush.label":       { zh: "饱满层次",   en: "Lush" },
  "scene.lush.desc":        { zh: "所有声部 ↑", en: "All tracks ↑" },
  "scene.less_drums.label": { zh: "鼓少一点",   en: "Fewer drums" },
  "scene.less_drums.desc":  { zh: "鼓 ↓",       en: "Drums ↓" },
  "scene.more_bass.label":  { zh: "加点贝斯",   en: "More bass" },
  "scene.more_bass.desc":   { zh: "贝斯 ↑",     en: "Bass ↑" },
  "scene.brighter.label":   { zh: "更明亮",     en: "Brighter" },
  "scene.brighter.desc":    { zh: "钟琴/合成 ↑", en: "Bell / synth ↑" },

  // ── Gallery ────────────────────────────────────────────────────────
  "gallery.eyebrow":  { zh: "MY RECORDS",      en: "MY RECORDS" },
  "gallery.title":    { zh: "灵感集",          en: "Gallery" },
  "gallery.subtitle": { zh: "你哼过的小歌，像贴纸一样存在这里。", en: "Every hum you've turned into a song, kept here like stickers in a notebook." },
  "gallery.empty.title": { zh: "还没有小歌", en: "No little songs yet" },
  "gallery.empty.detail":{ zh: "哼唱一段旋律，你的第一张唱片卡就在那里", en: "Hum a melody — your first record card will appear here" },
  "gallery.empty.cta":   { zh: "开始哼唱",   en: "Start humming" },
  "gallery.new_hum":     { zh: "新的哼唱",   en: "New hum" },

  // ── SongDetail ─────────────────────────────────────────────────────
  "song.not_found":      { zh: "找不到这首歌",       en: "Song not found" },
  "song.back_to_gallery":{ zh: "返回灵感集",         en: "Back to Gallery" },
  "song.meta.vibe":      { zh: "Vibe",               en: "Vibe" },
  "song.meta.bpm":       { zh: "BPM",                en: "BPM" },
  "song.meta.key":       { zh: "Key",                en: "Key" },
  "song.meta.duration":  { zh: "时长",               en: "Duration" },
  "song.arrangement":    { zh: "编曲构成",           en: "Arrangement" },
  "song.share.download_audio":{ zh: "下载音频",   en: "Download audio" },
  "song.share.download_page": { zh: "下载分享页", en: "Download share page" },
  "song.share.download_card": { zh: "下载分享卡", en: "Download share card" },
  "song.share.copy_link":     { zh: "复制链接",   en: "Copy link" },
  "song.share.copied":        { zh: "链接已复制", en: "Link copied" },
  "song.share.no_audio":      { zh: "音频还在渲染或不可用，请稍候", en: "Audio is still rendering or unavailable" },
  "song.export.exporting":    { zh: "导出中…",   en: "Exporting…" },
  "song.export.ok":           { zh: "已下载",     en: "Downloaded" },
  "song.export.err":          { zh: "导出失败，请重试", en: "Export failed — please retry" },

  // ── Me ─────────────────────────────────────────────────────────────
  "me.title":              { zh: "我的", en: "Me" },
  "me.stats.title":        { zh: "创作数据", en: "Activity" },
  "me.stats.songs":        { zh: "小歌",   en: "Songs" },
  "me.stats.vibes":        { zh: "氛围",   en: "Vibes" },
  "me.stats.melodies":     { zh: "旋律",   en: "Melodies" },
  "me.status.title":       { zh: "运行状态", en: "Runtime" },
  "me.status.transcribe":  { zh: "识别引擎", en: "Transcribe" },
  "me.status.arrange":     { zh: "伴奏引擎", en: "Arrangement" },
  "me.status.visual":      { zh: "视觉引擎", en: "Visual" },
  "me.status.export":      { zh: "导出格式", en: "Export" },
  "me.about.title":        { zh: "关于",   en: "About" },
  "me.about.desc":         { zh: "把脑海里的哼唱，变成一张可以收藏和分享的音乐卡片。", en: "Turn the hum in your head into a music card you can collect and share." },
  "me.about.version":      { zh: "v0.2.0 · Hackathon Edition", en: "v0.2.0 · Hackathon Edition" },
  "me.language.title":     { zh: "语言",   en: "Language" },
  "me.language.zh":        { zh: "中文",   en: "中文" },
  "me.language.en":        { zh: "English", en: "English" },
} as const;

export type TKey = keyof typeof DICT;
export type Lang = "zh" | "en";
