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

/**
 * Inter-onset-interval (IOI) approach.
 *
 * The earlier autocorrelation cost was broken: 60 BPM's 16th grid is so coarse
 * that *any* fast tempo's onsets land near a 16th boundary on it, making 60
 * the trivial winner. We now derive tempo directly from the *spacing* the
 * user hummed.
 *
 *   1. Compute IOIs between consecutive onsets.
 *   2. Reject implausibly tiny gaps (< 60ms — micro-onsets / pitch artifacts).
 *   3. Take the *mode* (most common bin) of the remaining IOIs — that's the
 *      user's effective beat subdivision.
 *   4. Decide which subdivision the mode represents (quarter / eighth / 16th
 *      / half) by mapping into the musical IOI ranges, then derive BPM.
 *   5. Clamp to [60, 140] and snap to nearest 2-BPM.
 */
export function detectBpm(notes: MelodyNote[]): number {
  if (notes.length < 2) return 80;

  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const iois: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i]!.start - sorted[i - 1]!.start;
    if (dt > 0.06) iois.push(dt); // toss <60ms (likely sub-notes)
  }
  if (iois.length === 0) return 80;

  // Histogram bin width = 20 ms; merge nearby IOIs.
  const BIN = 0.02;
  const buckets = new Map<number, number>();
  for (const ioi of iois) {
    const k = Math.round(ioi / BIN);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  // Find the bucket with max count
  let bestBucket = -1; let bestCount = 0;
  for (const [k, c] of buckets) {
    if (c > bestCount) { bestCount = c; bestBucket = k; }
  }
  const dominantIoi = bestBucket * BIN;

  // Decide subdivision. The dominant IOI represents the user's beat felt as a
  // 16th / 8th / quarter / half. Try each factor and score the resulting BPM.
  //
  // Scoring is *not* "distance to 90". That's wrong: 60-vs-120 are equidistant
  // from 90, so the prior version always picked 60 (first in the list). What we
  // actually want is:
  //   1. Prefer factor=1 (the IOI *is* the beat — the most direct read).
  //   2. Prefer higher tempo within [60, 140] — humming at 60 BPM is rare; if
  //      a doubling lands inside the range, it's almost always the right call.
  //
  // Together these break the 60-vs-120 tie correctly: factor=1 wins (lower
  // penalty), giving 120.
  const directBpm = 60 / dominantIoi;
  const candidates: Array<{ bpm: number; factor: number }> = [];
  for (const factor of [0.25, 0.5, 1, 2, 4]) {
    const bpm = directBpm * factor;
    if (bpm >= BPM_MIN && bpm <= BPM_MAX) candidates.push({ bpm, factor });
  }
  if (candidates.length === 0) return 80;

  candidates.sort((a, b) => {
    // Penalty 1: distance from factor=1 (the most natural reading)
    const factorCost = Math.abs(Math.log2(a.factor)) - Math.abs(Math.log2(b.factor));
    if (Math.abs(factorCost) > 0.01) return factorCost;
    // Tiebreaker: prefer higher BPM (rare to hum < 75)
    return b.bpm - a.bpm;
  });

  return Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(candidates[0]!.bpm / 2) * 2));
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
