// melody-polisher.ts — turns raw pitch detection output into a musically
// plausible monophonic lead line. This is where we absorb humming messiness:
// breath noise, tiny jitter notes, intonation drift, and ambiguous tonality.

import type { MelodyNote, CleanMelody } from "@/modules/shared/types";
import { detectBpm, quantize } from "@/lib/music/rhythm-engine";

type CoreScale = "major" | "minor";
type ScaleMode = CleanMelody["scale"];

const KEY_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10] as const;
const DORIAN_INTERVALS = [0, 2, 3, 5, 7, 9, 10] as const;
const PHRYGIAN_INTERVALS = [0, 1, 3, 5, 7, 8, 10] as const;
const PENTATONIC_MAJOR_INTERVALS = [0, 2, 4, 7, 9] as const;
const PENTATONIC_MINOR_INTERVALS = [0, 3, 5, 7, 10] as const;

interface TonalProfile {
  key: string;
  scale: ScaleMode;
  family: CoreScale;
  confidence: number;
}

export function polishMelody(rawNotes: MelodyNote[]): CleanMelody {
  const normalized = rawNotes.map(normalizeNote);

  let notes = normalized
    .filter((note) => note.confidence >= 0.42)
    .filter((note) => note.duration >= 0.06)
    .sort((a, b) => a.start - b.start);

  notes = compactNoiseBursts(notes);
  notes = mergeAdjacentNotes(notes);
  notes = removePitchOutliers(notes);
  notes = smoothPitchContour(notes);

  const bpm = detectBpm(notes);
  notes = quantize(notes, bpm, { grid: 16, softness: 0.22 });
  notes = revoiceQuantizedDurations(notes, bpm);

  const tonalProfile = inferTonalProfile(notes);
  notes = fitNotesToTonalProfile(notes, tonalProfile);
  notes = stabilizeCadence(notes, tonalProfile);
  notes = mergeAdjacentNotes(notes);

  const duration =
    notes.length > 0
      ? Math.max(...notes.map((note) => note.start + note.duration))
      : 0;

  return {
    notes,
    key: tonalProfile.key,
    scale: tonalProfile.scale,
    bpm,
    duration,
    contour: estimateContour(notes),
  };
}

function normalizeNote(note: MelodyNote): MelodyNote {
  return {
    ...note,
    velocity:
      note.velocity > 1
        ? clamp(note.velocity / 127, 0.05, 1)
        : clamp(note.velocity, 0.05, 1),
    confidence: clamp(note.confidence, 0, 1),
  };
}

function compactNoiseBursts(notes: MelodyNote[]): MelodyNote[] {
  if (notes.length <= 2) return notes;

  const medianPitch = getMedian(notes.map((note) => note.pitch));
  return notes.filter((note, index) => {
    const prev = index > 0 ? notes[index - 1] : null;
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const isolated =
      Boolean(prev && next) &&
      note.duration < 0.11 &&
      note.confidence < 0.6 &&
      Math.abs(note.pitch - prev!.pitch) >= 4 &&
      Math.abs(note.pitch - next!.pitch) >= 4;

    if (isolated) return false;

    const farFromCenter =
      Math.abs(note.pitch - medianPitch) >= 15 &&
      note.duration < 0.14 &&
      note.confidence < 0.65;

    return !farFromCenter;
  });
}

function mergeAdjacentNotes(notes: MelodyNote[]): MelodyNote[] {
  if (notes.length === 0) return notes;

  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const merged: MelodyNote[] = [{ ...sorted[0]! }];

  for (let index = 1; index < sorted.length; index++) {
    const prev = merged[merged.length - 1]!;
    const curr = sorted[index]!;
    const gap = curr.start - (prev.start + prev.duration);
    const semitoneDelta = Math.abs(curr.pitch - prev.pitch);

    if (gap <= 0.12 && semitoneDelta <= 1) {
      const totalWeight =
        prev.duration * prev.confidence + curr.duration * curr.confidence;
      prev.pitch =
        totalWeight > 0
          ? Math.round(
              (prev.pitch * prev.duration * prev.confidence +
                curr.pitch * curr.duration * curr.confidence) / totalWeight,
            )
          : prev.pitch;
      prev.duration = curr.start + curr.duration - prev.start;
      prev.velocity = clamp((prev.velocity + curr.velocity) / 2, 0.05, 1);
      prev.confidence = clamp(Math.max(prev.confidence, curr.confidence), 0, 1);
      continue;
    }

    merged.push({ ...curr });
  }

  return merged;
}

function removePitchOutliers(notes: MelodyNote[]): MelodyNote[] {
  if (notes.length < 4) return notes;

  const medianPitch = getMedian(notes.map((note) => note.pitch));
  return notes.filter((note, index) => {
    const prev = index > 0 ? notes[index - 1] : null;
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const localAnchor =
      prev && next ? Math.round((prev.pitch + next.pitch) / 2) : medianPitch;
    const drift = Math.abs(note.pitch - localAnchor);

    if (
      drift >= 10 &&
      note.duration < 0.18 &&
      note.confidence < 0.7 &&
      Math.abs(note.pitch - medianPitch) >= 8
    ) {
      return false;
    }

    return true;
  });
}

function smoothPitchContour(notes: MelodyNote[]): MelodyNote[] {
  if (notes.length < 3) return notes;

  return notes.map((note, index) => {
    const prev = index > 0 ? notes[index - 1] : null;
    const next = index < notes.length - 1 ? notes[index + 1] : null;

    if (!prev || !next) return note;

    const localAverage = (prev.pitch + note.pitch + next.pitch) / 3;
    const drift = note.pitch - localAverage;
    const strongAnchor = note.duration >= 0.42 || note.confidence >= 0.88;
    const largeLeap = Math.abs(drift) >= 1.75;

    if (!strongAnchor && largeLeap) {
      return {
        ...note,
        pitch: Math.round(localAverage),
      };
    }

    if (!strongAnchor && Math.abs(drift) >= 0.85) {
      return {
        ...note,
        pitch: Math.round(note.pitch - drift * 0.45),
      };
    }

    return note;
  });
}

function revoiceQuantizedDurations(notes: MelodyNote[], bpm: number): MelodyNote[] {
  if (notes.length === 0) return notes;

  const cell = 60 / bpm / 4;
  return notes.map((note, index) => {
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const maxDuration = next
      ? Math.max(cell, next.start - note.start)
      : Math.max(cell, note.duration);
    const snappedDuration = clamp(
      Math.max(cell, Math.round(note.duration / cell) * cell),
      cell,
      maxDuration,
    );

    return {
      ...note,
      duration: snappedDuration,
    };
  });
}

export function estimateKey(
  notes: MelodyNote[],
): { key: string; scale: CoreScale } {
  const profile = inferTonalProfile(notes);
  return {
    key: profile.key,
    scale: profile.family,
  };
}

function inferTonalProfile(notes: MelodyNote[]): TonalProfile {
  if (notes.length === 0) {
    return {
      key: "C",
      scale: "major",
      family: "major",
      confidence: 0,
    };
  }

  const pcWeights = buildPitchClassWeights(notes);
  const firstPc = mod12(notes[0]!.pitch);
  const lastPc = mod12(notes[notes.length - 1]!.pitch);
  const meanPitch = average(notes.map((note) => note.pitch));

  let best: TonalProfile = {
    key: "C",
    scale: "major",
    family: "major",
    confidence: -Infinity,
  };

  for (let root = 0; root < 12; root++) {
    const majorScore = scoreScale(pcWeights, root, MAJOR_INTERVALS);
    const minorScore = scoreScale(pcWeights, root, MINOR_INTERVALS);
    const dorianScore = scoreScale(pcWeights, root, DORIAN_INTERVALS) * 0.97;
    const phrygianScore = scoreScale(pcWeights, root, PHRYGIAN_INTERVALS) * 0.94;
    const majorPentScore =
      scoreScale(pcWeights, root, PENTATONIC_MAJOR_INTERVALS) * 0.92;
    const minorPentScore =
      scoreScale(pcWeights, root, PENTATONIC_MINOR_INTERVALS) * 0.92;

    const anchorBoost = anchorBonus(root, firstPc, lastPc);
    const phraseBrightnessBoost = meanPitch >= 66 ? 0.06 : 0;

    const candidates: TonalProfile[] = [
      {
        key: KEY_NAMES[root] ?? "C",
        scale: "major",
        family: "major",
        confidence: majorScore * 1.03 + anchorBoost + phraseBrightnessBoost,
      },
      {
        key: KEY_NAMES[root] ?? "C",
        scale: "minor",
        family: "minor",
        confidence: minorScore + anchorBoost,
      },
      {
        key: KEY_NAMES[root] ?? "C",
        scale: "dorian",
        family: "minor",
        confidence: dorianScore + anchorBoost * 0.9,
      },
      {
        key: KEY_NAMES[root] ?? "C",
        scale: "phrygian",
        family: "minor",
        confidence: phrygianScore + anchorBoost * 0.75,
      },
      {
        key: KEY_NAMES[root] ?? "C",
        scale: "pentatonic",
        family: majorScore >= minorScore ? "major" : "minor",
        confidence:
          Math.max(majorPentScore, minorPentScore) + anchorBoost * 0.7,
      },
    ];

    for (const candidate of candidates) {
      if (candidate.confidence > best.confidence) best = candidate;
    }
  }

  if (best.scale === "minor" && shouldFlipMinorToMajor(notes, best)) {
    return {
      key: best.key,
      scale: "major",
      family: "major",
      confidence: best.confidence,
    };
  }

  if (best.scale === "phrygian" && best.confidence < 1.1) {
    return {
      ...best,
      scale: "minor",
    };
  }

  return best;
}

function buildPitchClassWeights(notes: MelodyNote[]): number[] {
  const weights = new Array(12).fill(0);
  const sorted = [...notes].sort((a, b) => a.start - b.start);

  sorted.forEach((note, index) => {
    const anchorWeight =
      index === 0 || index === sorted.length - 1
        ? 1.9
        : note.duration >= 0.5
          ? 1.3
          : 1;
    weights[mod12(note.pitch)] +=
      note.duration *
      Math.max(0.1, note.velocity) *
      Math.max(0.1, note.confidence) *
      anchorWeight;
  });

  return weights;
}

function scoreScale(
  weights: number[],
  root: number,
  intervals: readonly number[],
): number {
  const inScale = new Set(intervals.map((interval) => mod12(root + interval)));
  let score = 0;

  for (let pc = 0; pc < 12; pc++) {
    const weight = weights[pc] ?? 0;
    if (inScale.has(pc)) {
      score += weight;
    } else {
      score -= weight * 0.52;
    }
  }

  return score;
}

function anchorBonus(root: number, firstPc: number, lastPc: number): number {
  let boost = 0;
  if (firstPc === root) boost += 0.2;
  if (lastPc === root) boost += 0.35;
  if (mod12(lastPc - root) === 7) boost += 0.08;
  return boost;
}

function shouldFlipMinorToMajor(notes: MelodyNote[], profile: TonalProfile): boolean {
  const root = KEY_NAMES.indexOf(profile.key as (typeof KEY_NAMES)[number]);
  if (root < 0) return false;

  const majorThird = mod12(root + 4);
  const minorThird = mod12(root + 3);
  let majorThirdWeight = 0;
  let minorThirdWeight = 0;

  for (const note of notes) {
    const pc = mod12(note.pitch);
    const weight = note.duration * note.confidence;
    if (pc === majorThird) majorThirdWeight += weight;
    if (pc === minorThird) minorThirdWeight += weight;
  }

  return majorThirdWeight >= minorThirdWeight * 0.82;
}

function fitNotesToTonalProfile(
  notes: MelodyNote[],
  profile: TonalProfile,
): MelodyNote[] {
  const root = KEY_NAMES.indexOf(profile.key as (typeof KEY_NAMES)[number]);
  const intervals = intervalsForProfile(profile);
  const scalePcs = new Set(intervals.map((interval) => mod12(root + interval)));
  const anchorPcs = new Set<number>([
    mod12(root),
    mod12(root + (profile.family === "major" ? 4 : 3)),
    mod12(root + 7),
  ]);

  return notes.map((note, index) => {
    const prev = index > 0 ? notes[index - 1] : null;
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const isAnchor = note.duration >= 0.45 || index === notes.length - 1;
    const correctionStrength = isAnchor ? 1 : 0.78;

    let bestPitch = note.pitch;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let delta = -3; delta <= 3; delta++) {
      const candidatePitch = note.pitch + delta;
      const candidatePc = mod12(candidatePitch);

      if (!scalePcs.has(candidatePc)) continue;

      const pitchPenalty = Math.abs(delta);
      const contourPenalty =
        prev && next
          ? contourMismatchPenalty(prev.pitch, candidatePitch, next.pitch)
          : 0;
      const anchorPenalty = anchorPcs.has(candidatePc) ? -0.22 : 0.08;

      const score =
        pitchPenalty * correctionStrength + contourPenalty + anchorPenalty;

      if (score < bestScore) {
        bestScore = score;
        bestPitch = candidatePitch;
      }
    }

    return {
      ...note,
      pitch: bestPitch,
    };
  });
}

function intervalsForProfile(profile: TonalProfile): readonly number[] {
  switch (profile.scale) {
    case "minor":
      return MINOR_INTERVALS;
    case "dorian":
      return DORIAN_INTERVALS;
    case "phrygian":
      return PHRYGIAN_INTERVALS;
    case "pentatonic":
      return profile.family === "major"
        ? PENTATONIC_MAJOR_INTERVALS
        : PENTATONIC_MINOR_INTERVALS;
    case "major":
    default:
      return MAJOR_INTERVALS;
  }
}

function contourMismatchPenalty(
  prevPitch: number,
  candidatePitch: number,
  nextPitch: number,
): number {
  const prevDiff = candidatePitch - prevPitch;
  const nextDiff = nextPitch - candidatePitch;

  if (Math.abs(prevDiff) >= 9 || Math.abs(nextDiff) >= 9) return 1.2;
  if (Math.abs(prevDiff) >= 6 || Math.abs(nextDiff) >= 6) return 0.48;
  return 0;
}

function stabilizeCadence(
  notes: MelodyNote[],
  profile: TonalProfile,
): MelodyNote[] {
  if (notes.length === 0) return notes;

  const root = KEY_NAMES.indexOf(profile.key as (typeof KEY_NAMES)[number]);
  const cadenceTargets =
    profile.family === "major"
      ? [mod12(root), mod12(root + 7), mod12(root + 4)]
      : [mod12(root), mod12(root + 7), mod12(root + 3)];

  return notes.map((note, index) => {
    const isCadenceZone = index >= notes.length - 2;
    if (!isCadenceZone) return note;

    const currentPc = mod12(note.pitch);
    if (cadenceTargets.includes(currentPc)) return note;

    let bestPitch = note.pitch;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const targetPc of cadenceTargets) {
      const upward = targetPc - currentPc;
      const downward = upward > 0 ? upward - 12 : upward + 12;
      const delta =
        Math.abs(upward) <= Math.abs(downward) ? upward : downward;
      if (Math.abs(delta) < bestDistance) {
        bestDistance = Math.abs(delta);
        bestPitch = note.pitch + delta;
      }
    }

    if (bestDistance <= 2) {
      return {
        ...note,
        pitch: bestPitch,
      };
    }

    return note;
  });
}

function estimateContour(notes: MelodyNote[]): "rising" | "falling" | "wave" | "flat" {
  if (notes.length < 2) return "flat";

  let ups = 0;
  let downs = 0;
  const sorted = [...notes].sort((a, b) => a.start - b.start);

  for (let index = 1; index < sorted.length; index++) {
    const diff = sorted[index]!.pitch - sorted[index - 1]!.pitch;
    if (diff > 0) ups++;
    if (diff < 0) downs++;
  }

  const total = ups + downs;
  if (total === 0) return "flat";
  if (total <= 2) {
    if (ups > 0 && downs === 0) return "rising";
    if (downs > 0 && ups === 0) return "falling";
    return "wave";
  }
  if (ups > downs * 1.5) return "rising";
  if (downs > ups * 1.5) return "falling";
  return "wave";
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}
