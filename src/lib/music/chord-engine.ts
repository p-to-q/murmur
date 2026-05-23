/**
 * chord-engine — produces a phrase-aware chord track from a polished melody.
 *
 * What it does:
 *   1. Picks ONE of several candidate chord progressions for the requested
 *      vibe + key + scale + contour. The progression is chosen by hashing
 *      melody fingerprint + a seed, so the same hum + seed gives the same
 *      progression but different seeds give variety.
 *
 *   2. Distributes those chords across the melody's phrases — one chord per
 *      phrase if phrases are dense, one chord per beat-of-phrase if they're
 *      sparse. This is the "chord follows breath" idea that keeps the song
 *      from sounding like a karaoke loop under the hum.
 *
 *   3. Voices each chord so its top note is close to the melody's average
 *      pitch at that moment — basic voice-leading that keeps the chord
 *      sitting *under* the hum instead of fighting it for the same range.
 *
 * Output is a timed list of chord events; the synth + render layers consume
 * the same list so live preview and final MP3 stay in sync.
 */

import type { CleanMelody } from "@/modules/shared/types";
import { detectPhrases, type Phrase } from "./rhythm-engine";
import { mulberry32, hashString } from "./seeded-random";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_INDEX: Record<string, number> = Object.fromEntries(
  NOTE_NAMES.map((n, i) => [n, i])
);
NOTE_INDEX["Db"] = 1; NOTE_INDEX["Eb"] = 3; NOTE_INDEX["Gb"] = 6;
NOTE_INDEX["Ab"] = 8; NOTE_INDEX["Bb"] = 10;

type QualityCode = 0 | 1 | 2 | 3 | 4 | 5;
//  0=maj  1=min  2=maj7  3=min7  4=dom7  5=sus4

interface ProgressionTemplate {
  /** [scaleDegree (0-6), qualityCode] pairs. scaleDegree is rooted in the
      tonic of the key (e.g. 0 = C in C major, 0 = A in A minor). */
  steps: Array<[number, QualityCode]>;
}

// Each vibe gets 2-3 candidate progressions so the same hum can come back
// different on a re-roll. Keep them musically plausible — no atonal moves.

const MAJOR_PROGRESSIONS: Record<string, ProgressionTemplate[]> = {
  sunset: [
    { steps: [[0, 2], [5, 3], [3, 2], [4, 5]] },     // Imaj7 vi7 IVmaj7 Vsus
    { steps: [[0, 2], [3, 2], [5, 3], [4, 2]] },     // Imaj7 IVmaj7 vi7 Vmaj7
    { steps: [[5, 3], [3, 2], [0, 2], [4, 4]] },     // vi7 IVmaj7 Imaj7 V7
  ],
  bedroom: [
    { steps: [[5, 3], [3, 2], [0, 0], [4, 0]] },     // vi7 IV I V
    { steps: [[0, 0], [4, 0], [5, 3], [3, 0]] },     // I V vi7 IV
    { steps: [[5, 3], [1, 3], [4, 0], [0, 2]] },     // vi7 ii7 V Imaj7
  ],
  cinematic: [
    { steps: [[0, 0], [5, 1], [3, 0], [4, 0]] },     // I vi IV V
    { steps: [[0, 0], [3, 0], [5, 1], [4, 0]] },     // I IV vi V
    { steps: [[5, 1], [3, 0], [0, 0], [4, 4]] },     // vi IV I V7
  ],
  party: [
    { steps: [[0, 0], [4, 0], [5, 1], [3, 0]] },     // I V vi IV
    { steps: [[0, 0], [3, 0], [4, 0], [0, 0]] },     // I IV V I
    { steps: [[5, 1], [3, 0], [4, 0], [0, 0]] },     // vi IV V I
  ],
  rain: [
    { steps: [[1, 3], [4, 3], [0, 2], [5, 3]] },     // ii7 V7 Imaj7 vi7
    { steps: [[5, 3], [1, 3], [4, 3], [0, 2]] },     // vi7 ii7 V7 Imaj7
    { steps: [[3, 2], [0, 2], [5, 3], [4, 4]] },     // IVmaj7 Imaj7 vi7 V7
  ],
  synth: [
    { steps: [[1, 1], [6, 0], [3, 0], [0, 0]] },     // ii bVII IV I
    { steps: [[5, 1], [4, 0], [3, 0], [0, 0]] },     // vi V IV I
    { steps: [[0, 0], [6, 0], [3, 0], [4, 0]] },     // I bVII IV V
  ],
};

// Minor-key analogue — same indices but starting from the minor tonic.
const MINOR_PROGRESSIONS: Record<string, ProgressionTemplate[]> = {
  sunset: [
    { steps: [[0, 3], [3, 2], [6, 2], [4, 4]] },     // i7 IIImaj7 VIImaj7 V7
    { steps: [[0, 3], [5, 0], [3, 2], [4, 4]] },     // i7 VI IIImaj7 V7
    { steps: [[3, 2], [6, 2], [0, 3], [4, 4]] },     // IIImaj7 VIImaj7 i7 V7
  ],
  bedroom: [
    { steps: [[0, 3], [5, 3], [3, 2], [6, 2]] },     // i7 vi7 IIImaj7 VIImaj7
    { steps: [[0, 1], [5, 0], [3, 0], [6, 0]] },     // i VI III VII
    { steps: [[5, 0], [3, 0], [0, 1], [4, 4]] },     // VI III i V7
  ],
  cinematic: [
    { steps: [[0, 1], [5, 0], [3, 0], [4, 0]] },     // i VI III IV
    { steps: [[0, 1], [3, 0], [6, 0], [4, 0]] },     // i III VII IV
    { steps: [[5, 0], [3, 0], [0, 1], [4, 0]] },     // VI III i IV
  ],
  party: [
    { steps: [[0, 1], [5, 0], [3, 0], [2, 4]] },     // i VI III ii7
    { steps: [[0, 1], [3, 0], [5, 0], [4, 4]] },     // i III VI V7
    { steps: [[5, 0], [3, 0], [0, 1], [4, 0]] },     // VI III i IV
  ],
  rain: [
    { steps: [[1, 3], [0, 3], [3, 2], [5, 3]] },     // ii7 i7 IIImaj7 vi7
    { steps: [[5, 3], [1, 3], [0, 3], [6, 2]] },     // vi7 ii7 i7 VIImaj7
    { steps: [[3, 2], [6, 2], [5, 3], [0, 3]] },     // IIImaj7 VIImaj7 vi7 i7
  ],
  synth: [
    { steps: [[0, 1], [5, 0], [3, 0], [4, 4]] },     // i VI III V7
    { steps: [[0, 1], [3, 0], [5, 0], [6, 0]] },     // i III VI VII
    { steps: [[6, 0], [5, 0], [3, 0], [0, 1]] },     // VII VI III i
  ],
};

// Intervals: scale-degree (0..6) → semitone offset from the tonic.
const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];
const MINOR_DEGREES = [0, 2, 3, 5, 7, 8, 10];

const QUALITY_INTERVALS: Record<QualityCode, number[]> = {
  0: [0, 4, 7],       // maj
  1: [0, 3, 7],       // min
  2: [0, 4, 7, 11],   // maj7
  3: [0, 3, 7, 10],   // min7
  4: [0, 4, 7, 10],   // dom7
  5: [0, 5, 7],       // sus4
};

const QUALITY_SUFFIX: Record<QualityCode, string> = {
  0: "", 1: "m", 2: "maj7", 3: "m7", 4: "7", 5: "sus4",
};

// ── Voicing ────────────────────────────────────────────────────────────

/** Pick the chord octave such that its TOP note sits within ±5 semitones
    of the melody's local average. Keeps the chord under (not over) the hum. */
export function voicedChordMidi(
  rootMidi: number,
  intervals: number[],
  melodyMidiTarget: number
): number[] {
  // Generate chord starting at rootMidi - 12, then in each octave find which
  // top note is closest to the target. Pick the octave that wins.
  let best = { dist: Infinity, octaveShift: 0 };
  for (let oct = -2; oct <= 1; oct++) {
    const top = rootMidi + intervals[intervals.length - 1]! + oct * 12;
    const dist = Math.abs(top - melodyMidiTarget);
    if (dist < best.dist) best = { dist, octaveShift: oct };
  }
  return intervals.map((iv) => rootMidi + iv + best.octaveShift * 12);
}

// ── Public types ───────────────────────────────────────────────────────

export interface ChordEvent {
  /** Time in seconds (relative to song start). */
  time: number;
  /** Duration this chord is held, in seconds. */
  duration: number;
  /** Symbolic chord name, e.g. "Cmaj7". For the strummer-code surface. */
  name: string;
  /** Concrete MIDI notes, already voice-led near the melody range. */
  midi: number[];
  /** The chord's root MIDI in its primary octave — useful for bass. */
  rootMidi: number;
  /** Which phrase index this chord belongs to. */
  phraseIndex: number;
}

export interface ChordTrack {
  events: ChordEvent[];
  /** Symbolic names in order — kept for backwards compat (currentPattern). */
  names: string[];
  /** The progression template that was chosen, for debugging / display. */
  templateLabel: string;
}

// ── Main entry ─────────────────────────────────────────────────────────

/**
 * Build a chord track for the given melody under the requested vibe.
 *
 * `seed` controls which candidate progression + voicing variations get
 * picked — pass the version id (or any stable string) so re-renders are
 * deterministic but different versions feel different.
 */
export function buildChordTrack(
  melody: CleanMelody,
  vibeId: string,
  seed: string
): ChordTrack {
  const rng = mulberry32(hashString(seed));

  const isMinor = melody.scale === "minor";
  const table = isMinor ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS;
  const pool = table[vibeId] ?? table.sunset ?? [];
  const template = pool[Math.floor(rng() * pool.length)] ?? pool[0]!;

  const tonicPc = NOTE_INDEX[melody.key] ?? 0;
  const degrees = isMinor ? MINOR_DEGREES : MAJOR_DEGREES;

  // Pre-compute symbolic name + intervals for each chord in the progression.
  const symbolic = template.steps.map(([degreeIdx, quality]) => {
    const semitoneOffset = degrees[degreeIdx] ?? 0;
    const rootPc = (tonicPc + semitoneOffset) % 12;
    const rootName = NOTE_NAMES[rootPc] ?? "C";
    return {
      rootPc,
      name: rootName + QUALITY_SUFFIX[quality],
      intervals: QUALITY_INTERVALS[quality],
    };
  });

  // ── Phrase distribution ────────────────────────────────────────────
  const phrases = detectPhrases(melody.notes, melody.bpm);
  const beat = 60 / melody.bpm;

  const events: ChordEvent[] = [];

  if (phrases.length === 0) {
    return { events: [], names: [], templateLabel: vibeId };
  }

  // Total melody length — use it as outer bound.
  const totalDur = Math.max(...phrases.map((p) => p.end));

  // Strategy: one chord per phrase, but if a phrase is longer than 4 beats
  // we subdivide it into ~4-beat slots so a long held note gets motion.
  let chordIdx = 0;
  for (let p = 0; p < phrases.length; p++) {
    const phrase = phrases[p]!;
    const slots = subdividePhrase(phrase, beat);
    for (const slot of slots) {
      const sym = symbolic[chordIdx % symbolic.length]!;
      const melodyTarget = averageMelodyPitch(phrase) || 67;
      const rootMidi = nearestRoot(sym.rootPc, melodyTarget - 12);
      const midi = voicedChordMidi(rootMidi, sym.intervals, melodyTarget);
      events.push({
        time: slot.start,
        duration: slot.end - slot.start,
        name: sym.name,
        midi,
        rootMidi: rootMidi - 12, // bass register
        phraseIndex: p,
      });
      chordIdx++;
    }
  }

  // Trim the final chord so it doesn't run past the melody.
  const last = events[events.length - 1];
  if (last) last.duration = Math.max(beat, totalDur - last.time + beat * 0.5);

  return {
    events,
    names: events.map((e) => e.name),
    templateLabel: vibeId,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function subdividePhrase(phrase: Phrase, beat: number): Array<{ start: number; end: number }> {
  const phraseLen = phrase.end - phrase.start;
  const maxSlot = beat * 4;
  if (phraseLen <= maxSlot) return [{ start: phrase.start, end: phrase.end }];

  const slots: Array<{ start: number; end: number }> = [];
  let t = phrase.start;
  while (t < phrase.end - 0.05) {
    const next = Math.min(t + maxSlot, phrase.end);
    slots.push({ start: t, end: next });
    t = next;
  }
  return slots;
}

function averageMelodyPitch(phrase: Phrase): number {
  if (!phrase.notes.length) return 67;
  let weightSum = 0;
  let total = 0;
  for (const n of phrase.notes) {
    weightSum += n.pitch * n.duration;
    total += n.duration;
  }
  return total > 0 ? weightSum / total : 67;
}

function nearestRoot(rootPc: number, around: number): number {
  // Snap rootPc to nearest octave of `around`.
  const baseOctave = Math.floor(around / 12) * 12;
  const candidates = [baseOctave + rootPc, baseOctave + rootPc + 12, baseOctave + rootPc - 12];
  return candidates.reduce((a, b) =>
    Math.abs(b - around) < Math.abs(a - around) ? b : a
  );
}
