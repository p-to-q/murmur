/**
 * drum-engine — produces a timed drum sequence with fills and intensity ramps.
 *
 * The arrangement layer picks a pattern by vibe; this engine then:
 *   - tiles the pattern bar-by-bar over the total length
 *   - inserts a fill every 4 bars (or before a phrase boundary)
 *   - applies a slight intensity ramp + ghost notes for the lo-fi feel
 *
 * Outputs DrumHit[], absolute times, type ∈ kick/snare/hihat/open/ghost. The
 * synth + renderer translate `type` to their respective synth voices.
 */

import { mulberry32, hashString } from "./seeded-random";

export type DrumPattern =
  | "soft"
  | "swing"
  | "four_on_floor"
  | "four_hi"
  | "sparse"
  | "slow"
  | "halftime";

export type DrumHitType = "kick" | "snare" | "hihat" | "open" | "ghost";

export interface DrumHit {
  /** Absolute time in seconds. */
  time: number;
  /** Which voice. */
  type: DrumHitType;
  /** Velocity 0..1. */
  velocity: number;
}

interface BuildArgs {
  pattern: DrumPattern;
  bpm: number;
  totalDuration: number;
  intensity: number; // 0..1 — scales velocity
  seed: string;
  /** Phrase boundaries (sec). Fills cluster just before each. */
  phraseBoundaries?: number[];
}

const PATTERNS: Record<DrumPattern, Array<{ t: number; type: DrumHitType; v?: number }>> = {
  // Each entry: t is in beats within a bar (0..4)
  soft: [
    { t: 0, type: "kick" }, { t: 2, type: "snare" },
    { t: 0.5, type: "hihat", v: 0.6 }, { t: 1, type: "hihat", v: 0.5 },
    { t: 1.5, type: "hihat", v: 0.6 }, { t: 2.5, type: "hihat", v: 0.6 },
    { t: 3, type: "hihat", v: 0.5 }, { t: 3.5, type: "hihat", v: 0.6 },
    { t: 2.75, type: "ghost", v: 0.35 },
  ],
  swing: [
    { t: 0, type: "kick" }, { t: 1.5, type: "snare" },
    { t: 2.5, type: "kick" }, { t: 3, type: "snare" },
    { t: 0.66, type: "hihat", v: 0.55 }, { t: 1.33, type: "hihat", v: 0.5 },
    { t: 2, type: "hihat", v: 0.6 }, { t: 2.66, type: "hihat", v: 0.55 },
    { t: 3.33, type: "hihat", v: 0.55 },
    { t: 1.83, type: "ghost", v: 0.3 },
  ],
  four_on_floor: [
    { t: 0, type: "kick" }, { t: 1, type: "kick" },
    { t: 2, type: "kick" }, { t: 3, type: "kick" },
    { t: 1, type: "snare" }, { t: 3, type: "snare" },
    { t: 0.5, type: "hihat", v: 0.6 }, { t: 1.5, type: "hihat", v: 0.5 },
    { t: 2.5, type: "hihat", v: 0.6 }, { t: 3.5, type: "hihat", v: 0.5 },
    { t: 0.25, type: "ghost", v: 0.3 }, { t: 2.25, type: "ghost", v: 0.3 },
  ],
  four_hi: [
    { t: 0, type: "kick" }, { t: 1, type: "kick" },
    { t: 2, type: "kick" }, { t: 3, type: "kick" },
    { t: 0.5, type: "open", v: 0.55 }, { t: 1.5, type: "open", v: 0.5 },
    { t: 2.5, type: "open", v: 0.55 }, { t: 3.5, type: "open", v: 0.5 },
    { t: 1, type: "snare" }, { t: 3, type: "snare" },
  ],
  sparse: [
    { t: 0, type: "kick" }, { t: 3, type: "snare" },
    { t: 1.5, type: "hihat", v: 0.5 },
  ],
  slow: [
    { t: 0, type: "kick" }, { t: 2, type: "snare" },
    { t: 1, type: "hihat", v: 0.55 }, { t: 3, type: "hihat", v: 0.55 },
  ],
  halftime: [
    { t: 0, type: "kick" }, { t: 2.5, type: "snare" },
    { t: 1, type: "hihat", v: 0.5 }, { t: 2, type: "hihat", v: 0.5 },
    { t: 3, type: "hihat", v: 0.5 },
  ],
};

const FILL_LIBRARY: Array<Array<{ t: number; type: DrumHitType; v?: number }>> = [
  // 1-beat fill — three snare rolls into bar 1
  [
    { t: 3.0, type: "snare", v: 0.6 },
    { t: 3.25, type: "snare", v: 0.65 },
    { t: 3.5, type: "snare", v: 0.7 },
    { t: 3.75, type: "snare", v: 0.8 },
  ],
  // 1/2-bar tom fill
  [
    { t: 2.5, type: "ghost", v: 0.55 },
    { t: 2.75, type: "snare", v: 0.55 },
    { t: 3.0, type: "snare", v: 0.6 },
    { t: 3.25, type: "ghost", v: 0.65 },
    { t: 3.5, type: "snare", v: 0.7 },
    { t: 3.75, type: "snare", v: 0.78 },
  ],
  // Crash + roll
  [
    { t: 3.5, type: "open", v: 0.8 },
    { t: 3.75, type: "snare", v: 0.75 },
  ],
];

export function buildDrumTrack({
  pattern,
  bpm,
  totalDuration,
  intensity,
  seed,
  phraseBoundaries = [],
}: BuildArgs): DrumHit[] {
  if (intensity <= 0.04) return [];

  const rng = mulberry32(hashString(seed + ":drums"));
  const beat = 60 / bpm;
  const bar = beat * 4;
  const numBars = Math.ceil(totalDuration / bar);
  const baseFigure = PATTERNS[pattern] ?? PATTERNS.soft;

  const out: DrumHit[] = [];
  const intensityCurve = (barIdx: number) => {
    // Ramp gently from 0.85 → 1.0 over the song so the song feels like it's
    // moving toward something instead of staying flat.
    const t = numBars > 1 ? barIdx / (numBars - 1) : 0;
    return 0.85 + 0.15 * t;
  };

  // Treat phrase boundaries as "where a fill should land just before".
  const fillBars = new Set<number>();
  for (const pb of phraseBoundaries) {
    const barIdx = Math.floor(pb / bar) - 1;
    if (barIdx >= 1) fillBars.add(barIdx);
  }
  // Also add a fill every 4th bar
  for (let b = 3; b < numBars; b += 4) fillBars.add(b);

  for (let b = 0; b < numBars; b++) {
    const barStart = b * bar;
    const isFill = fillBars.has(b);

    // Always lay down the base figure first
    for (const hit of baseFigure) {
      const t = barStart + hit.t * beat;
      if (t >= totalDuration) continue;
      // Skip beat-4 hits if this bar will get a fill there
      if (isFill && hit.t >= 2.5) continue;
      out.push({
        time: t,
        type: hit.type,
        velocity: (hit.v ?? 0.85) * intensity * intensityCurve(b),
      });
    }

    // Overlay fill if needed
    if (isFill) {
      const fill = FILL_LIBRARY[Math.floor(rng() * FILL_LIBRARY.length)]!;
      for (const hit of fill) {
        const t = barStart + hit.t * beat;
        if (t >= totalDuration) continue;
        out.push({
          time: t,
          type: hit.type,
          velocity: (hit.v ?? 0.85) * intensity * intensityCurve(b),
        });
      }
    }
  }

  // Tiny random humanization — ±10ms timing wobble for non-kick voices.
  for (const h of out) {
    if (h.type !== "kick") {
      h.time += (rng() - 0.5) * 0.012;
    }
  }

  return out.sort((a, b) => a.time - b.time);
}
