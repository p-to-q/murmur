import type { ArrangementState } from "@/modules/shared/types";

/**
 * Edit token allowlist.
 *
 * This is the *only* surface for mutating an ArrangementState. The Studio UI
 * sends user intent through this list (either from the rule-based parser or
 * the LLM /api/strummer/edit endpoint). Adding a new edit means: append it
 * here, handle it in `applyEdit`, optionally add hints to `parsePromptToToken`,
 * and expose it through a Scene preset or button.
 */
export type EditToken =
  // Mood
  | "warmer"
  | "brighter"
  | "darker"
  // Density
  | "less_drums"
  | "more_drums"
  | "no_drums"
  | "more_bass"
  | "less_bass"
  | "no_bass"
  | "more_strings"
  | "less_strings"
  | "more_texture"
  // Tempo (BPM via Tone Transport — applied at playback time)
  | "faster"
  | "slower"
  // Melody instrument swap (changes melody.instrument)
  | "melody_piano"
  | "melody_bell"
  | "melody_guitar"
  | "melody_synth"
  | "melody_marimba"
  // Chord instrument swap
  | "chords_piano"
  | "chords_guitar"
  | "chords_synth"
  | "chords_strings"
  // Whole-arrangement presets
  | "cinematic"
  | "party"
  | "more_rhythm"
  // Restore
  | "restore_drums"
  | "restore_all";

export const ALL_EDIT_TOKENS: EditToken[] = [
  "warmer", "brighter", "darker",
  "less_drums", "more_drums", "no_drums",
  "more_bass", "less_bass", "no_bass",
  "more_strings", "less_strings", "more_texture",
  "faster", "slower",
  "melody_piano", "melody_bell", "melody_guitar", "melody_synth", "melody_marimba",
  "chords_piano", "chords_guitar", "chords_synth", "chords_strings",
  "cinematic", "party", "more_rhythm",
  "restore_drums", "restore_all",
];

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

function setInstrument(
  state: ArrangementState,
  trackKey: keyof ArrangementState,
  instrument: string
): ArrangementState {
  const track = state[trackKey];
  return {
    ...state,
    [trackKey]: {
      ...track,
      instrument,
      versionHistory: [...track.versionHistory, track.instrument],
    },
  };
}

export function applyEdit(state: ArrangementState, token: EditToken): ArrangementState {
  switch (token) {
    // ── Mood ───────────────────────────────────────────────────────────
    case "warmer":
      return {
        ...state,
        chords:  { ...state.chords,  intensity: clamp(state.chords.intensity + 0.12) },
        strings: { ...state.strings, intensity: clamp(state.strings.intensity + 0.18), enabled: true },
        texture: { ...state.texture, intensity: clamp(state.texture.intensity + 0.12), enabled: true },
        drums:   { ...state.drums,   intensity: clamp(state.drums.intensity - 0.1, 0.05) },
      };

    case "brighter":
      return {
        ...state,
        melody:  { ...state.melody,  instrument: state.melody.instrument === "piano" ? "bell" : state.melody.instrument, intensity: clamp(state.melody.intensity + 0.05) },
        chords:  { ...state.chords,  intensity: clamp(state.chords.intensity + 0.08) },
        texture: { ...state.texture, intensity: clamp(state.texture.intensity - 0.05, 0) },
      };

    case "darker":
      return {
        ...state,
        chords:  { ...state.chords,  intensity: clamp(state.chords.intensity - 0.05, 0.1) },
        strings: { ...state.strings, instrument: "cello_pad", intensity: clamp(state.strings.intensity + 0.1), enabled: true },
        texture: { ...state.texture, intensity: clamp(state.texture.intensity + 0.15), enabled: true },
        drums:   { ...state.drums,   intensity: clamp(state.drums.intensity - 0.12, 0.05) },
      };

    // ── Drums ──────────────────────────────────────────────────────────
    case "less_drums":
      return {
        ...state,
        drums: {
          ...state.drums,
          intensity: clamp(state.drums.intensity - 0.25, 0.05),
          versionHistory: [...state.drums.versionHistory, state.drums.currentPattern],
        },
      };
    case "more_drums":
      return {
        ...state,
        drums: {
          ...state.drums,
          enabled: true,
          intensity: clamp(state.drums.intensity + 0.25),
          versionHistory: [...state.drums.versionHistory, state.drums.currentPattern],
        },
      };
    case "no_drums":
      return {
        ...state,
        drums: { ...state.drums, enabled: false, intensity: 0,
          versionHistory: [...state.drums.versionHistory, state.drums.currentPattern] },
      };

    // ── Bass ───────────────────────────────────────────────────────────
    case "more_bass":
      return {
        ...state,
        bass: {
          ...state.bass,
          enabled: true,
          intensity: clamp(state.bass.intensity + 0.25),
          versionHistory: [...state.bass.versionHistory, state.bass.currentPattern],
        },
      };
    case "less_bass":
      return {
        ...state,
        bass: { ...state.bass, intensity: clamp(state.bass.intensity - 0.2, 0.05),
          versionHistory: [...state.bass.versionHistory, state.bass.currentPattern] },
      };
    case "no_bass":
      return {
        ...state,
        bass: { ...state.bass, enabled: false, intensity: 0,
          versionHistory: [...state.bass.versionHistory, state.bass.currentPattern] },
      };

    // ── Strings ────────────────────────────────────────────────────────
    case "more_strings":
      return {
        ...state,
        strings: { ...state.strings, enabled: true, intensity: clamp(state.strings.intensity + 0.2),
          versionHistory: [...state.strings.versionHistory, state.strings.currentPattern] },
      };
    case "less_strings":
      return {
        ...state,
        strings: { ...state.strings, intensity: clamp(state.strings.intensity - 0.2, 0),
          versionHistory: [...state.strings.versionHistory, state.strings.currentPattern] },
      };

    case "more_texture":
      return {
        ...state,
        texture: { ...state.texture, enabled: true, intensity: clamp(state.texture.intensity + 0.2) },
      };

    // ── Tempo (BPM doesn't live on TrackState; we apply via versionHistory
    //     marker so the Studio playback layer can pick it up).
    //
    //     The Studio reads version's melody.bpm directly; tempo edits should
    //     mutate the version's melody.bpm, not the arrangement, so we leave
    //     these as no-ops on the arrangement and the *caller* (Studio) will
    //     adjust melody.bpm separately when these tokens fire.
    case "faster":
    case "slower":
      return state;

    // ── Melody instrument ──────────────────────────────────────────────
    case "melody_piano":   return setInstrument(state, "melody", "piano");
    case "melody_bell":    return setInstrument(state, "melody", "bell");
    case "melody_guitar":  return setInstrument(state, "melody", "acoustic_guitar");
    case "melody_synth":   return setInstrument(state, "melody", "synth_lead");
    case "melody_marimba": return setInstrument(state, "melody", "marimba");

    // ── Chord instrument ───────────────────────────────────────────────
    case "chords_piano":   return setInstrument(state, "chords", "piano");
    case "chords_guitar":  return setInstrument(state, "chords", "acoustic_guitar");
    case "chords_synth":   return setInstrument(state, "chords", "synth_pad");
    case "chords_strings": return setInstrument(state, "chords", "strings");

    // ── Whole-arrangement preset shifts ────────────────────────────────
    case "cinematic":
      return {
        ...state,
        strings: { ...state.strings, instrument: "strings", intensity: 0.75, enabled: true },
        drums:   { ...state.drums,   intensity: clamp(state.drums.intensity - 0.2, 0.05) },
        texture: { ...state.texture, enabled: true, intensity: 0.5 },
        chords:  { ...state.chords,  intensity: clamp(state.chords.intensity + 0.1) },
      };
    case "party":
      return {
        ...state,
        drums:   { ...state.drums, enabled: true, instrument: "dance_kit", intensity: clamp(state.drums.intensity + 0.3) },
        bass:    { ...state.bass,  enabled: true, intensity: clamp(state.bass.intensity + 0.2) },
        texture: { ...state.texture, enabled: true, intensity: 0.6 },
      };
    case "more_rhythm":
      return {
        ...state,
        drums: { ...state.drums, enabled: true, intensity: clamp(state.drums.intensity + 0.2) },
        bass:  { ...state.bass,  enabled: true, intensity: clamp(state.bass.intensity + 0.1) },
      };

    // ── Restore ────────────────────────────────────────────────────────
    case "restore_drums":
      return {
        ...state,
        drums: {
          ...state.drums,
          intensity: state.drums.versionHistory.length > 0 ? 0.55 : state.drums.intensity,
          currentPattern: state.drums.originalPattern,
          versionHistory: [],
        },
      };
    case "restore_all":
      return {
        melody: { ...state.melody, currentPattern: state.melody.originalPattern, intensity: 0.8, enabled: true, versionHistory: [] },
        chords: { ...state.chords, currentPattern: state.chords.originalPattern, intensity: 0.55, enabled: true, versionHistory: [] },
        strings:{ ...state.strings, currentPattern: state.strings.originalPattern, intensity: 0.45, enabled: true, versionHistory: [] },
        drums:  { ...state.drums,  currentPattern: state.drums.originalPattern, intensity: 0.55, enabled: true, versionHistory: [] },
        bass:   { ...state.bass,   currentPattern: state.bass.originalPattern, intensity: 0.5, enabled: true, versionHistory: [] },
        texture:{ ...state.texture, currentPattern: state.texture.originalPattern, intensity: 0.35, enabled: true, versionHistory: [] },
      };

    default:
      return state;
  }
}

/** BPM delta for tempo edits — Studio is responsible for applying this. */
export function tempoDelta(token: EditToken): number {
  if (token === "faster") return 10;
  if (token === "slower") return -10;
  return 0;
}

/**
 * Rule-based fallback parser. Tries to map a freeform user prompt to an
 * EditToken. Returns null when nothing matches — callers should then try the
 * LLM endpoint `/api/strummer/edit` and surface a "didn't understand" toast
 * if both fail.
 */
export function parsePromptToToken(prompt: string): EditToken | null {
  const p = prompt.toLowerCase().trim();
  if (!p) return null;

  const has = (...words: string[]) => words.some((w) => p.includes(w));

  // Restore — check first because "重置鼓" should beat "鼓"
  if (has("恢复全部", "全部还原", "restore all", "reset all")) return "restore_all";
  if (has("恢复鼓", "鼓还原", "restore drums", "reset drums")) return "restore_drums";
  if (has("恢复", "还原", "撤销", "undo", "restore")) return "restore_all";

  // Tempo
  if (has("更快", "快一点", "加快", "faster", "speed up")) return "faster";
  if (has("更慢", "慢一点", "放慢", "slower", "slow down")) return "slower";

  // Melody instrument
  if (has("主旋律换成钢琴", "melody piano")) return "melody_piano";
  if (has("主旋律换成钟", "melody bell", "钟琴")) return "melody_bell";
  if (has("主旋律吉他", "melody guitar")) return "melody_guitar";
  if (has("主旋律合成", "melody synth")) return "melody_synth";
  if (has("马林巴", "marimba")) return "melody_marimba";

  // Chord instrument
  if (has("和弦钢琴", "chord piano", "chords piano")) return "chords_piano";
  if (has("和弦吉他", "chord guitar", "chords guitar", "民谣吉他")) return "chords_guitar";
  if (has("和弦合成", "chord synth", "chords synth")) return "chords_synth";
  if (has("和弦弦乐", "chord strings", "chords strings")) return "chords_strings";

  // Strings & texture
  if (has("更多弦乐", "弦乐 up", "弦乐多", "more strings")) return "more_strings";
  if (has("少点弦乐", "弦乐少", "less strings")) return "less_strings";
  if (has("更多氛围", "氛围多", "more texture", "more air")) return "more_texture";

  // Drums
  if (has("没有鼓", "去掉鼓", "no drums", "remove drums")) return "no_drums";
  if (has("鼓少", "鼓 少", "less drum", "softer beat", "鼓 ↓")) return "less_drums";
  if (has("鼓多", "鼓 多", "more drum", "stronger beat", "鼓 ↑")) return "more_drums";
  if (has("节奏", "rhythm", "bounce", "groove")) return "more_rhythm";

  // Bass
  if (has("没有贝斯", "去掉贝斯", "no bass", "remove bass")) return "no_bass";
  if (has("加贝斯", "更多贝斯", "贝斯多", "more bass", "bass up")) return "more_bass";
  if (has("贝斯少", "less bass", "soft bass")) return "less_bass";

  // Generic instrument hints (legacy compat)
  if (has("钢琴", "piano")) return "chords_piano";
  if (has("吉他", "guitar")) return "chords_guitar";
  if (has("合成", "synth", "电子")) return "chords_synth";
  if (has("弦乐", "string")) return "more_strings";

  // Whole-arrangement preset shifts
  if (has("电影", "cinematic", "片尾", "电影感", "lush film")) return "cinematic";
  if (has("派对", "party", "活泼", "dance")) return "party";

  // Mood
  if (has("温暖", "warm", "warmer", "暖和")) return "warmer";
  if (has("更亮", "brighter", "明亮")) return "brighter";
  if (has("更暗", "darker", "暗一点", "深沉")) return "darker";

  return null;
}
