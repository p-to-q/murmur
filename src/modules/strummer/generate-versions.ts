import type {
  ArrangementState, CleanMelody, TrackState, VibeVersion, VisualConfig,
} from "@/modules/shared/types";
import { VIBE_PRESETS } from "@/presets/vibes";
import { mulberry32, hashString, pick } from "@/lib/music/seeded-random";
import type { BassPattern } from "@/lib/music/bass-engine";
import type { DrumPattern } from "@/lib/music/drum-engine";
import { log } from "@/lib/observability/log";
import {
  INSTRUMENT_RANGES,
  clampPitchToInstrument,
  type InstrumentId,
} from "@murmur/core/music/instrument-ranges";
import { generateStrummerCode } from "./generate-code";

/**
 * Each vibe gets 2-3 "ensembles" (a coherent set of instruments + bass &
 * drum pattern names + intensity recipe). The seeded picker chooses one per
 * version, so two passes over the same hum give two genuinely different
 * arrangements — not just the same template with different colours.
 */

interface Ensemble {
  melody:  { instrument: string; intensity: number };
  chords:  { instrument: string; intensity: number };
  strings: { instrument: string; intensity: number; enabled: boolean };
  bass:    { instrument: string; pattern: BassPattern; intensity: number };
  drums:   { instrument: string; pattern: DrumPattern; intensity: number };
  texture: { instrument: string; intensity: number; enabled: boolean };
}

const ENSEMBLES: Record<string, Ensemble[]> = {
  sunset: [
    {
      melody:  { instrument: "bell",        intensity: 0.78 },
      chords:  { instrument: "piano",       intensity: 0.55 },
      strings: { instrument: "soft_pad",    intensity: 0.45, enabled: true },
      bass:    { instrument: "upright_bass",pattern: "walking",      intensity: 0.55 },
      drums:   { instrument: "brush_kit",   pattern: "soft",         intensity: 0.42 },
      texture: { instrument: "warm_air",    intensity: 0.32, enabled: true },
    },
    {
      melody:  { instrument: "electric_piano", intensity: 0.72 },
      chords:  { instrument: "piano",          intensity: 0.6 },
      strings: { instrument: "soft_pad",       intensity: 0.4, enabled: true },
      bass:    { instrument: "soft_bass",      pattern: "root_sustain", intensity: 0.5 },
      drums:   { instrument: "brush_kit",      pattern: "swing",        intensity: 0.36 },
      texture: { instrument: "tape_hiss",      intensity: 0.28, enabled: true },
    },
  ],
  bedroom: [
    {
      melody:  { instrument: "electric_piano", intensity: 0.7 },
      chords:  { instrument: "vinyl_pad",      intensity: 0.5 },
      strings: { instrument: "soft_pad",       intensity: 0.35, enabled: true },
      bass:    { instrument: "soft_bass",      pattern: "root_sustain", intensity: 0.55 },
      drums:   { instrument: "lofi_kit",       pattern: "swing",        intensity: 0.42 },
      texture: { instrument: "tape_hiss",      intensity: 0.32, enabled: true },
    },
    {
      melody:  { instrument: "piano",          intensity: 0.68 },
      chords:  { instrument: "piano",          intensity: 0.55 },
      strings: { instrument: "vinyl_pad",      intensity: 0.38, enabled: true },
      bass:    { instrument: "upright_bass",   pattern: "root_sustain", intensity: 0.48 },
      drums:   { instrument: "lofi_kit",       pattern: "halftime",     intensity: 0.36 },
      texture: { instrument: "warm_air",       intensity: 0.3, enabled: true },
    },
  ],
  cinematic: [
    {
      melody:  { instrument: "piano",          intensity: 0.82 },
      chords:  { instrument: "strings",        intensity: 0.6 },
      strings: { instrument: "cello_pad",      intensity: 0.7, enabled: true },
      bass:    { instrument: "cello_bass",     pattern: "walking",      intensity: 0.55 },
      drums:   { instrument: "sparse_kit",     pattern: "slow",         intensity: 0.32 },
      texture: { instrument: "reverb_hall",    intensity: 0.45, enabled: true },
    },
    {
      melody:  { instrument: "bell",           intensity: 0.78 },
      chords:  { instrument: "strings",        intensity: 0.55 },
      strings: { instrument: "cello_pad",      intensity: 0.65, enabled: true },
      bass:    { instrument: "cello_bass",     pattern: "root_sustain", intensity: 0.55 },
      drums:   { instrument: "sparse_kit",     pattern: "sparse",       intensity: 0.28 },
      texture: { instrument: "reverb_hall",    intensity: 0.4, enabled: true },
    },
  ],
  party: [
    {
      melody:  { instrument: "synth_lead",     intensity: 0.85 },
      chords:  { instrument: "stab_synth",     intensity: 0.65 },
      strings: { instrument: "synth_pad",      intensity: 0.45, enabled: true },
      bass:    { instrument: "synth_bass",     pattern: "sidechain",    intensity: 0.75 },
      drums:   { instrument: "dance_kit",      pattern: "four_on_floor",intensity: 0.85 },
      texture: { instrument: "sidechain",      intensity: 0.5, enabled: true },
    },
    {
      melody:  { instrument: "arp_synth",      intensity: 0.78 },
      chords:  { instrument: "poly_synth",     intensity: 0.6 },
      strings: { instrument: "synth_pad",      intensity: 0.42, enabled: true },
      bass:    { instrument: "synth_bass",     pattern: "arpeggio",     intensity: 0.65 },
      drums:   { instrument: "dance_kit",      pattern: "four_hi",      intensity: 0.78 },
      texture: { instrument: "modular_air",    intensity: 0.42, enabled: true },
    },
  ],
  rain: [
    {
      melody:  { instrument: "marimba",        intensity: 0.65 },
      chords:  { instrument: "piano",          intensity: 0.48 },
      strings: { instrument: "ambient_pad",    intensity: 0.55, enabled: true },
      bass:    { instrument: "fretless",       pattern: "root_sustain", intensity: 0.42 },
      drums:   { instrument: "rain_perc",      pattern: "sparse",       intensity: 0.3 },
      texture: { instrument: "rain_air",       intensity: 0.62, enabled: true },
    },
    {
      melody:  { instrument: "bell",           intensity: 0.62 },
      chords:  { instrument: "vinyl_pad",      intensity: 0.5 },
      strings: { instrument: "ambient_pad",    intensity: 0.6, enabled: true },
      bass:    { instrument: "soft_bass",      pattern: "root_sustain", intensity: 0.4 },
      drums:   { instrument: "rain_perc",      pattern: "halftime",     intensity: 0.26 },
      texture: { instrument: "rain_air",       intensity: 0.55, enabled: true },
    },
  ],
  synth: [
    {
      melody:  { instrument: "arp_synth",      intensity: 0.82 },
      chords:  { instrument: "poly_synth",     intensity: 0.62 },
      strings: { instrument: "filter_pad",     intensity: 0.5, enabled: true },
      bass:    { instrument: "sub_bass",       pattern: "sidechain",    intensity: 0.7 },
      drums:   { instrument: "electro_kit",    pattern: "four_hi",      intensity: 0.72 },
      texture: { instrument: "modular_air",    intensity: 0.48, enabled: true },
    },
    {
      melody:  { instrument: "synth_lead",     intensity: 0.78 },
      chords:  { instrument: "stab_synth",     intensity: 0.58 },
      strings: { instrument: "synth_pad",      intensity: 0.48, enabled: true },
      bass:    { instrument: "synth_bass",     pattern: "arpeggio",     intensity: 0.65 },
      drums:   { instrument: "electro_kit",    pattern: "four_on_floor",intensity: 0.7 },
      texture: { instrument: "modular_air",    intensity: 0.42, enabled: true },
    },
  ],
};

// ── Vibe selection (kept as before but cleaner) ────────────────────────

function pickThreeDistinctVibes(melody: CleanMelody) {
  const scored = VIBE_PRESETS.map((p) => {
    let score = Math.random() * 2.0;
    if (melody.scale === "minor" && ["cinematic", "bedroom", "rain"].includes(p.id)) score += 1.5;
    if (melody.scale === "major" && ["sunset", "party", "synth"].includes(p.id)) score += 1.5;
    if (melody.bpm < 80 && p.energy < 0.5) score += 0.8;
    if (melody.bpm > 100 && p.energy > 0.6) score += 0.8;
    if (melody.contour === "rising" && ["party", "synth", "sunset"].includes(p.id)) score += 0.6;
    if (melody.contour === "falling" && ["cinematic", "bedroom", "rain"].includes(p.id)) score += 0.6;
    return { preset: p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const sorted = scored.map((s) => s.preset);
  const top    = sorted[0]!;
  const middle = sorted[Math.floor(sorted.length / 2)]!;
  const bottom = sorted[sorted.length - 1]!;

  const picks = [top];
  if (middle.id !== top.id) picks.push(middle);
  else picks.push(sorted[1]!);
  const third = [bottom, ...sorted].find((p) => !picks.some((q) => q.id === p.id));
  if (third) picks.push(third);
  return picks.slice(0, 3);
}

// ── Track helper ───────────────────────────────────────────────────────

function track(
  instrument: string,
  currentPattern: string,
  intensity: number,
  enabled = true,
  typedFields: Partial<
    Pick<TrackState, "melodyPitchSequence" | "chordsTag" | "bassPattern" | "drumsPattern" | "texturePreset">
  > = {},
): TrackState {
  return {
    enabled,
    intensity,
    originalPattern: currentPattern,
    currentPattern,
    instrument,
    versionHistory: [],
    ...typedFields,
  };
}

// ── Main ──────────────────────────────────────────────────────────────

export function generateVibeVersions(
  melody: CleanMelody,
  options: {
    draftId?: string;
    originFlowId?: string;
    sourceType?: VibeVersion["sourceType"];
  } = {},
): VibeVersion[] {
  const startedAt = performance.now();
  const picks = pickThreeDistinctVibes(melody);
  let rangeClampCount = 0;
  const draftId = options.draftId ?? crypto.randomUUID();
  const originFlowId = options.originFlowId ?? crypto.randomUUID();
  const sourceType = options.sourceType ?? "hum";

  const versions = picks.map((preset) => {
    const id = crypto.randomUUID();
    const rng = mulberry32(hashString(id));
    const candidates = ENSEMBLES[preset.id] ?? ENSEMBLES.sunset!;
    const ensemble = pick(rng, candidates);
    const melodyFit = clampMelodyToCarrier(melody, ensemble.melody.instrument);
    if (melodyFit.applied) rangeClampCount += 1;

    // currentPattern remains for legacy rows and Strummer code display. New
    // runtime reads should prefer the typed fields below.
    const melPat   = melodyFit.melody.notes.map((n) => n.pitch).join(" ");
    const chordPat = `gen:${preset.id}`; // marker — real chords come from chord-engine

    const arr: ArrangementState = {
      melody: track(
        ensemble.melody.instrument,
        melPat,
        ensemble.melody.intensity,
        true,
        { melodyPitchSequence: melodyFit.melody.notes.map((n) => n.pitch) },
      ),
      chords: track(
        ensemble.chords.instrument,
        chordPat,
        ensemble.chords.intensity,
        true,
        { chordsTag: preset.id },
      ),
      strings: track(
        ensemble.strings.instrument,
        chordPat,
        ensemble.strings.intensity,
        ensemble.strings.enabled,
        { chordsTag: preset.id },
      ),
      drums: track(
        ensemble.drums.instrument,
        ensemble.drums.pattern,
        ensemble.drums.intensity,
        true,
        { drumsPattern: ensemble.drums.pattern },
      ),
      bass: track(
        ensemble.bass.instrument,
        ensemble.bass.pattern,
        ensemble.bass.intensity,
        true,
        { bassPattern: ensemble.bass.pattern },
      ),
      texture: track(
        ensemble.texture.instrument,
        `tex:${preset.id}`,
        ensemble.texture.intensity,
        ensemble.texture.enabled,
        { texturePreset: preset.id },
      ),
    };

    const visualConfig: VisualConfig = {
      preset:         preset.visualPreset,
      gradient:       preset.gradient,
      particleDensity:preset.energy,
      pulseSource:    preset.energy > 0.6 ? "drums" : "melody",
    };

    return {
      id,
      draftId,
      originFlowId,
      sourceType,
      versionSeed: id,
      title: preset.titleGenerator(),
      vibe: preset.label,
      tags: [...preset.tags],
      melody: melodyFit.melody,
      arrangementState: arr,
      visualConfig,
      strummerCode: generateStrummerCode(arr),
    };
  });

  log("arrangement.generated", {
    bpm: melody.bpm,
    key: melody.key,
    scale: melody.scale,
    noteCount: melody.notes.length,
    melodyCarriers: versions.map((version) => version.arrangementState.melody.instrument),
    rangeClampCount,
    versionIds: versions.map((version) => version.id),
    vibes: versions.map((version) => version.vibe),
  }, {
    durationMs: Math.round(performance.now() - startedAt),
  });

  return versions;
}

function clampMelodyToCarrier(
  melody: CleanMelody,
  instrument: string,
): { melody: CleanMelody; applied: boolean } {
  if (!isInstrumentId(instrument)) {
    return { melody, applied: false };
  }

  const range = INSTRUMENT_RANGES[instrument];
  if (!range.canCarryMelody) {
    return { melody, applied: false };
  }

  const clampedNotes = clampPitchToInstrument(melody.notes, instrument);
  const applied = clampedNotes.some((note, index) => note.pitch !== melody.notes[index]?.pitch);
  if (!applied) {
    return { melody, applied: false };
  }

  return {
    melody: {
      ...melody,
      notes: clampedNotes,
    },
    applied: true,
  };
}

function isInstrumentId(value: string): value is InstrumentId {
  return value in INSTRUMENT_RANGES;
}
