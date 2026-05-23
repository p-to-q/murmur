/**
 * bass-engine — produces a timed bass line from a ChordTrack.
 *
 * Four pattern styles exist, each picked per-vibe by the arrangement layer:
 *
 *   root_sustain — one long root note per chord. The original behavior.
 *                  Suits very calm vibes (rain, bedroom).
 *
 *   walking      — root → fifth → leading-tone → next-chord-root over each
 *                  chord. Standard jazz/folk feel. Suits sunset, cinematic.
 *
 *   arpeggio     — eighth-note up-arpeggio through root → fifth → octave →
 *                  third. Suits party, synth, anything that wants forward
 *                  motion.
 *
 *   sidechain    — root pulsing on every quarter with a duck on beats 2 & 4.
 *                  Suits electronic / synth vibes.
 *
 * All patterns return BassNote[] with absolute times, so the synth and the
 * offline renderer consume identical data.
 */

import type { ChordEvent } from "./chord-engine";

export type BassPattern = "root_sustain" | "walking" | "arpeggio" | "sidechain";

export interface BassNote {
  /** Time in seconds (absolute, relative to song start). */
  time: number;
  /** MIDI note number. */
  pitch: number;
  /** Duration in seconds. */
  duration: number;
  /** Velocity 0..1. */
  velocity: number;
}

interface BuildArgs {
  chords: ChordEvent[];
  bpm: number;
  pattern: BassPattern;
}

export function buildBassLine({ chords, bpm, pattern }: BuildArgs): BassNote[] {
  if (chords.length === 0) return [];
  const beat = 60 / bpm;
  switch (pattern) {
    case "root_sustain": return rootSustain(chords);
    case "walking":      return walking(chords, beat);
    case "arpeggio":     return arpeggio(chords, beat);
    case "sidechain":    return sidechain(chords, beat);
  }
}

// ── Patterns ──────────────────────────────────────────────────────────

function rootSustain(chords: ChordEvent[]): BassNote[] {
  return chords.map((c) => ({
    time: c.time,
    pitch: c.rootMidi - 12,
    duration: c.duration * 0.9,
    velocity: 0.72,
  }));
}

function walking(chords: ChordEvent[], beat: number): BassNote[] {
  const out: BassNote[] = [];
  const step = beat;
  for (let i = 0; i < chords.length; i++) {
    const cur = chords[i]!;
    const next = chords[i + 1];
    const root = cur.rootMidi - 12;
    const fifth = root + 7;
    const targetRoot = next ? next.rootMidi - 12 : root;
    // Approach: pick a half-step (leading tone) above or below the next root.
    const lead = targetRoot - 1 < root ? targetRoot + 1 : targetRoot - 1;

    const beatsInChord = Math.max(1, Math.round(cur.duration / beat));
    // Walking is a 4-beat figure; gracefully degrade if chord is shorter.
    const figure = beatsInChord >= 4
      ? [root, fifth, lead, targetRoot]
      : beatsInChord === 3
        ? [root, fifth, lead]
        : beatsInChord === 2
          ? [root, fifth]
          : [root];
    for (let b = 0; b < figure.length; b++) {
      out.push({
        time: cur.time + b * step,
        pitch: figure[b]!,
        duration: step * 0.85,
        velocity: 0.7,
      });
    }
  }
  return out;
}

function arpeggio(chords: ChordEvent[], beat: number): BassNote[] {
  const out: BassNote[] = [];
  const step = beat / 2; // eighth notes
  for (const cur of chords) {
    const root = cur.rootMidi - 12;
    const fig = [root, root + 7, root + 12, root + 4, root + 7, root + 12, root + 7, root + 4];
    const beats = Math.max(1, Math.round(cur.duration / beat));
    const slots = beats * 2; // 8th notes count
    for (let i = 0; i < slots; i++) {
      out.push({
        time: cur.time + i * step,
        pitch: fig[i % fig.length]!,
        duration: step * 0.85,
        velocity: 0.6,
      });
    }
  }
  return out;
}

function sidechain(chords: ChordEvent[], beat: number): BassNote[] {
  const out: BassNote[] = [];
  for (const cur of chords) {
    const root = cur.rootMidi - 12;
    const beats = Math.max(1, Math.round(cur.duration / beat));
    for (let b = 0; b < beats; b++) {
      // Quarter pulse — strong on 1 and 3, ducked on 2 and 4.
      const onBeat = b % 4;
      const vel = onBeat === 0 || onBeat === 2 ? 0.78 : 0.38;
      out.push({
        time: cur.time + b * beat,
        pitch: root,
        duration: beat * 0.4,
        velocity: vel,
      });
    }
  }
  return out;
}
