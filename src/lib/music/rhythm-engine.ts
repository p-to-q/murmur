/**
 * rhythm-engine — turns raw pitch-detected notes into a rhythmically sensible
 * structure that the arrangement engine can phrase against.
 *
 * Three things happen here, in order:
 *
 *   1. detectBpm        — autocorrelation over onset intervals. We try
 *                         many candidate BPMs and pick the one whose grid
 *                         best explains the onsets the user actually hummed.
 *                         Much more stable than "median interval × 60".
 *
 *   2. quantize         — soft 16th-note quantization with a small swing
 *                         allowance. Notes snap to the grid but their
 *                         relative emphasis (longer/shorter) is preserved
 *                         instead of being bulldozed to identical 8ths.
 *
 *   3. detectPhrases    — finds natural breath points by looking for
 *                         (a) gaps ≥ a quarter-note, (b) the longest note
 *                         followed by a step-down. Phrase boundaries are
 *                         what the arrangement engine uses to time chord
 *                         changes — chords don't change on a fixed clock,
 *                         they change where the *melody* breathes.
 */

import type { MelodyNote } from "@/modules/shared/types";

// ── BPM detection ────────────────────────────────────────────────────────

const BPM_MIN = 60;
const BPM_MAX = 140;
const BPM_STEP = 2;

/**
 * Try every candidate BPM in [60..140] step 2. For each, compute the cost of
 * snapping every onset to the nearest 16th-note position on that grid. Lowest
 * cost wins. Falls back to 80 BPM when input is too sparse to be meaningful.
 */
export function detectBpm(notes: MelodyNote[]): number {
  if (notes.length < 3) return 80;

  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const onsets = sorted.map((n) => n.start);

  let bestBpm = 80;
  let bestCost = Infinity;

  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += BPM_STEP) {
    const sixteenth = 60 / bpm / 4;
    let cost = 0;
    for (const t of onsets) {
      // distance to nearest 16th
      const snapped = Math.round(t / sixteenth) * sixteenth;
      const err = Math.abs(t - snapped) / sixteenth; // normalized 0..0.5
      cost += err * err;
    }
    // light penalty for very fast tempos — humming above 130 is rare
    if (bpm > 120) cost *= 1 + (bpm - 120) * 0.005;

    if (cost < bestCost) {
      bestCost = cost;
      bestBpm = bpm;
    }
  }

  return bestBpm;
}

// ── Quantization with feel preservation ──────────────────────────────────

/**
 * Snap each note's start and duration to the 16th-note grid.
 *
 * Two important departures from naive quantize:
 *   - Duration is kept proportional to ORIGINAL duration ratios. A note
 *     hummed long stays long; a quick note stays quick.
 *   - Notes within `softness * grid` of their snap point move only halfway,
 *     leaving a touch of human feel on tightly hummed phrases.
 */
export function quantize(
  notes: MelodyNote[],
  bpm: number,
  opts: { grid?: 8 | 16 | 32; softness?: number } = {}
): MelodyNote[] {
  const subdivisions = opts.grid ?? 16;
  const softness = opts.softness ?? 0.2;
  const beat = 60 / bpm;
  const cell = (beat * 4) / subdivisions; // one grid cell in seconds

  return notes.map((n) => {
    const snapped = Math.round(n.start / cell) * cell;
    const err = n.start - snapped;
    const softnessThresh = cell * softness;
    // If the original onset is already very close to grid, keep it.
    const newStart = Math.abs(err) < softnessThresh ? snapped + err * 0.5 : snapped;

    // Preserve duration shape — snap to grid but never collapse to one cell.
    const minDur = cell;
    const snappedDur = Math.max(minDur, Math.round(n.duration / cell) * cell);
    return { ...n, start: newStart, duration: snappedDur };
  });
}

// ── Phrase / breath detection ────────────────────────────────────────────

export interface Phrase {
  /** Start time of the first note in the phrase (seconds). */
  start: number;
  /** End time of the last note + its duration (seconds). */
  end: number;
  /** Notes belonging to this phrase. */
  notes: MelodyNote[];
  /** The note with the longest duration in the phrase (its "anchor"). */
  anchor: MelodyNote;
}

/**
 * Split the melody into phrases at natural breath points.
 *
 * Breaks happen when:
 *   - The gap to the next note ≥ one quarter-note, OR
 *   - The current note is the longest in its window AND the next note
 *     starts at a lower pitch (a "step down" — common cadence).
 *
 * Phrases give the arrangement engine where to put chord changes — instead
 * of slamming a new chord every 4 beats, chords land where the melody
 * actually pauses, which is what makes the song "feel" connected to the
 * hum rather than glued on top.
 */
export function detectPhrases(notes: MelodyNote[], bpm: number): Phrase[] {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const beat = 60 / bpm;
  const breathGap = beat * 0.9; // ≈ one quarter-note

  const phrases: Phrase[] = [];
  let current: MelodyNote[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const gap = curr.start - (prev.start + prev.duration);
    const stepDown = curr.pitch < prev.pitch - 2 && prev.duration > beat * 0.6;

    if (gap >= breathGap || stepDown) {
      phrases.push(makePhrase(current));
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  if (current.length) phrases.push(makePhrase(current));
  return phrases;
}

function makePhrase(notes: MelodyNote[]): Phrase {
  const last = notes[notes.length - 1]!;
  const first = notes[0]!;
  const anchor = notes.reduce((a, b) => (b.duration > a.duration ? b : a), notes[0]!);
  return {
    start: first.start,
    end: last.start + last.duration,
    notes,
    anchor,
  };
}
