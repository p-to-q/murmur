/**
 * assemble-song — the single function that turns a VibeVersion into the
 * timed event tracks that both the live synth and the offline renderer
 * consume.
 *
 * Inputs:
 *   - version.melody        (already polished, BPM + phrase-friendly)
 *   - version.arrangementState  (which tracks are on, instruments, intensities)
 *   - version.id              (used as the RNG seed, so the output is
 *                              byte-for-byte reproducible across plays and
 *                              across the preview/offline path)
 *
 * Outputs:
 *   - melody  — pass-through (the user's polished hum)
 *   - chords  — phrase-aware chord events with voiced MIDI
 *   - bass    — pattern-aware bass line
 *   - drums   — bar-tiled pattern with fills + intensity ramp
 *
 * Both `simple-synth.ts` and `render-mp3.ts` call this — that guarantees a
 * Card preview, a Studio audition, and the saved MP3 all sound identical.
 */

import type { VibeVersion } from "@/modules/shared/types";
import { buildChordTrack, type ChordEvent } from "./chord-engine";
import { buildBassLine, type BassNote, type BassPattern } from "./bass-engine";
import { buildDrumTrack, type DrumHit, type DrumPattern } from "./drum-engine";
import { detectPhrases } from "./rhythm-engine";

export interface AssembledSong {
  bpm: number;
  /** Total length in seconds — extended past the melody so chord + drum tails
      have somewhere to breathe. */
  totalDuration: number;
  chords: ChordEvent[];
  bass: BassNote[];
  drums: DrumHit[];
  /** Vibe-id we were assembling for; lets the synth pick its texture voice. */
  vibeId: string;
}

const KNOWN_BASS_PATTERNS = new Set<BassPattern>([
  "root_sustain", "walking", "arpeggio", "sidechain",
]);
const KNOWN_DRUM_PATTERNS = new Set<DrumPattern>([
  "soft", "swing", "four_on_floor", "four_hi", "sparse", "slow", "halftime",
]);

export function assembleSong(version: VibeVersion): AssembledSong {
  const melody = version.melody;
  const arrangement = version.arrangementState;

  // Total duration: extend past the melody so the arrangement gets a tail.
  const melodyEnd = melody.notes.length
    ? Math.max(...melody.notes.map((n) => n.start + n.duration))
    : 8;
  const beat = 60 / Math.max(40, Math.min(200, melody.bpm));
  const padding = beat * 2; // ~half a bar of tail
  const totalDuration = Math.max(8, melodyEnd + padding);

  // ── Chord track via chord-engine (voiced, phrase-aware) ────────────
  const chordTrack = buildChordTrack(melody, vibeKeyFromArrangement(version), version.id);

  const bassPattern = pickBassPattern(
    arrangement.bass.bassPattern ?? arrangement.bass.currentPattern,
    version.id,
  );
  const bass = arrangement.bass.enabled
    ? buildBassLine({ chords: chordTrack.events, bpm: melody.bpm, pattern: bassPattern })
    : [];

  // ── Drums ──────────────────────────────────────────────────────────
  const drumPattern = pickDrumPattern(
    arrangement.drums.drumsPattern ?? arrangement.drums.currentPattern,
  );
  const phraseBoundaries = detectPhrases(melody.notes, melody.bpm).map((p) => p.end);
  const drums = arrangement.drums.enabled
    ? buildDrumTrack({
        pattern: drumPattern,
        bpm: melody.bpm,
        totalDuration,
        intensity: arrangement.drums.intensity,
        seed: version.id,
        phraseBoundaries,
      })
    : [];

  return {
    bpm: melody.bpm,
    totalDuration,
    chords: chordTrack.events,
    bass,
    drums,
    vibeId: vibeKeyFromArrangement(version),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function pickBassPattern(stored: string, seed: string): BassPattern {
  if (KNOWN_BASS_PATTERNS.has(stored as BassPattern)) return stored as BassPattern;
  // Legacy `currentPattern` strings were chord progressions ("C G Am F"),
  // so they won't match. Hash the seed to pick a deterministic fallback.
  const choices: BassPattern[] = ["root_sustain", "walking", "arpeggio"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return choices[Math.abs(h) % choices.length]!;
}

function pickDrumPattern(stored: string): DrumPattern {
  if (KNOWN_DRUM_PATTERNS.has(stored as DrumPattern)) return stored as DrumPattern;
  return "soft";
}

/** Prefer the typed v2 chord tag, then fall back to the legacy
    `currentPattern = "gen:<vibeId>"` stamp for saved v1 rows. */
function vibeKeyFromArrangement(version: VibeVersion): string {
  const typedTag = version.arrangementState.chords.chordsTag;
  if (typedTag) return typedTag;
  const stamp = version.arrangementState.chords.currentPattern;
  if (stamp.startsWith("gen:")) return stamp.slice(4);
  const tag = (version.tags[0] ?? "").toLowerCase();
  if (tag.includes("warm") || tag.includes("piano")) return "sunset";
  if (tag.includes("lo-fi") || tag.includes("vinyl")) return "bedroom";
  if (tag.includes("string") || tag.includes("cinemat")) return "cinematic";
  if (tag.includes("party") || tag.includes("dance")) return "party";
  if (tag.includes("rain") || tag.includes("ambient")) return "rain";
  if (tag.includes("synth")) return "synth";
  return "sunset";
}
