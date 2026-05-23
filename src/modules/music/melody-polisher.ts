// melody-polisher.ts — cleans raw pitch detection output into a usable
// CleanMelody. Defers rhythm understanding (BPM, quantize, phrasing) to the
// new rhythm-engine so the same logic feeds both the synth and the
// arrangement engine.

import type { MelodyNote, CleanMelody } from "@/modules/shared/types";
import { detectBpm, quantize } from "@/lib/music/rhythm-engine";

export function polishMelody(rawNotes: MelodyNote[]): CleanMelody {
  // 0. Normalise velocity to 0–1 range (MIDI uses 0–127; some providers emit floats)
  const normalized = rawNotes.map((n) => ({
    ...n,
    velocity: n.velocity > 1 ? n.velocity / 127 : n.velocity,
  }));

  // 1. Filter low-confidence + ultra-short notes
  let notes = normalized.filter((n) => n.confidence > 0.5 && n.duration >= 0.08);

  // 2. Merge adjacent same-pitch notes within 100ms (kills wobble artifacts)
  notes = mergeAdjacentNotes(notes);

  // 3. Tempo + quantize via rhythm-engine (autocorrelation BPM, 16th grid,
  //    duration shape preserved).
  const bpm = detectBpm(notes);
  notes = quantize(notes, bpm, { grid: 16, softness: 0.25 });

  // 4. Key estimation (Krumhansl-style) and snap to scale
  const { key, scale } = estimateKey(notes);
  notes = snapToScale(notes, key, scale);

  const duration = notes.length > 0
    ? Math.max(...notes.map((n) => n.start + n.duration))
    : 0;

  return {
    notes,
    key,
    scale,
    bpm,
    duration,
    contour: estimateContour(notes),
  };
}

function mergeAdjacentNotes(notes: MelodyNote[]): MelodyNote[] {
  if (notes.length === 0) return notes;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const merged: MelodyNote[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]!;
    const curr = sorted[i]!;
    const gap = curr.start - (prev.start + prev.duration);
    if (curr.pitch === prev.pitch && gap < 0.1) {
      prev.duration = curr.start + curr.duration - prev.start;
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

export function estimateKey(notes: MelodyNote[]): { key: string; scale: "major" | "minor" } {
  if (notes.length === 0) return { key: "C", scale: "major" };

  const pcWeights: number[] = new Array(12).fill(0);
  notes.forEach((n) => {
    pcWeights[n.pitch % 12]! += n.duration * Math.max(0.05, n.velocity);
  });

  const keyNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const majorTemplate = [1, 0, 0.5, 0, 1, 0.8, 0, 1, 0, 0.5, 0, 0.5];
  const minorTemplate = [1, 0, 0.5, 0.8, 0, 0.8, 0, 1, 0.5, 0, 0.5, 0];

  let bestKey = 0;
  let bestScale: "major" | "minor" = "major";
  let bestScore = -Infinity;

  for (let root = 0; root < 12; root++) {
    let majorScore = 0;
    let minorScore = 0;
    for (let i = 0; i < 12; i++) {
      majorScore += (pcWeights[(root + i) % 12] ?? 0) * (majorTemplate[i] ?? 0);
      minorScore += (pcWeights[(root + i) % 12] ?? 0) * (minorTemplate[i] ?? 0);
    }
    if (majorScore > bestScore) { bestScore = majorScore; bestKey = root; bestScale = "major"; }
    if (minorScore > bestScore) { bestScore = minorScore; bestKey = root; bestScale = "minor"; }
  }

  return { key: keyNames[bestKey] ?? "C", scale: bestScale };
}

function snapToScale(notes: MelodyNote[], key: string, scale: "major" | "minor"): MelodyNote[] {
  const keyNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const root = keyNames.indexOf(key);
  const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
  const minorIntervals = [0, 2, 3, 5, 7, 8, 10];
  const intervals = scale === "major" ? majorIntervals : minorIntervals;
  const scalePcs = new Set(intervals.map((i) => (root + i) % 12));

  return notes.map((n) => {
    const pc = n.pitch % 12;
    if (scalePcs.has(pc)) return n;
    // Snap to nearest scale note
    let minDist = 12;
    let snapPc = pc;
    for (const spc of scalePcs) {
      const dist = Math.min(Math.abs(spc - pc), 12 - Math.abs(spc - pc));
      if (dist < minDist) { minDist = dist; snapPc = spc; }
    }
    const octave = Math.floor(n.pitch / 12);
    return { ...n, pitch: octave * 12 + snapPc };
  });
}

function estimateContour(notes: MelodyNote[]): "rising" | "falling" | "wave" | "flat" {
  if (notes.length < 3) return "flat";
  let ups = 0, downs = 0;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i]!.pitch - sorted[i - 1]!.pitch;
    if (diff > 0) ups++;
    if (diff < 0) downs++;
  }
  if (ups > downs * 1.5) return "rising";
  if (downs > ups * 1.5) return "falling";
  if (Math.abs(ups - downs) < 3) return "flat";
  return "wave";
}
