"use client";

/**
 * SongCoverArt — deterministic generative cover for the Gallery grid.
 *
 * Specced in docs/page-redesign.md §7.
 *
 * Replaces v1's "initials on gradient" pattern (every song looked the same).
 * Renders a small SVG with the vibe gradient + 2 sine wave paths whose
 * amplitude / phase / frequency are derived from a stable hash of the song's
 * id, bpm, and key. Same song = same cover, every render. No animation —
 * the Gallery is a quiet shelf, not a dashboard.
 *
 * The component is tiny + has no external deps. For animated covers (e.g.
 * SongDetail), use MurmurWave instead.
 */

import { useId, useMemo } from "react";

export interface SongCoverArtProps {
  /** CSS gradient string — typically `song.visualConfig.gradient`. */
  gradient: string;
  /** ulid / uuid of the song; drives the deterministic pattern. */
  seed: string;
  /** Optional — folded into the seed for extra variance. */
  bpm?: number;
  /** Optional — folded into the seed. */
  keySig?: string;
  /** Optional — first 1-2 letters of title rendered tiny in the corner. */
  initials?: string;
  className?: string;
  /** SVG viewBox edge length. Default 200. */
  size?: number;
}

export function SongCoverArt({
  gradient,
  seed,
  bpm,
  keySig,
  initials,
  className,
  size = 200,
}: SongCoverArtProps) {
  const uid = useId();
  const gradId = `cover-grad-${uid}`;

  const fingerprint = useMemo(
    () => buildFingerprint(`${seed}|${bpm ?? 0}|${keySig ?? ""}`, size),
    [seed, bpm, keySig, size],
  );

  // The vibe gradient comes in as a CSS string. We can't paint a CSS gradient
  // inside an SVG natively, so we either (a) wrap the SVG in a div with that
  // background, or (b) extract stops and rebuild as <linearGradient>. We do
  // (a) — simpler + lets the same CSS string work everywhere else in the app.
  return (
    <div
      className={className}
      style={{ background: gradient, position: "relative", overflow: "hidden" }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.22)" />
          </linearGradient>
        </defs>

        {/* Soft vignette so any white text reads on top */}
        <rect x="0" y="0" width={size} height={size} fill={`url(#${gradId})`} />

        {/* Two wave paths — fingerprint of this song */}
        <path
          d={fingerprint.pathA}
          fill="none"
          stroke="rgba(255,255,255,0.42)"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
        <path
          d={fingerprint.pathB}
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth={1.1}
          strokeLinecap="round"
        />

        {/* A faint third path lower down for added depth */}
        <path
          d={fingerprint.pathC}
          fill="none"
          stroke="rgba(0,0,0,0.10)"
          strokeWidth={1}
          strokeLinecap="round"
        />

        {/* Tiny initials, bottom-right, almost invisible */}
        {initials && (
          <text
            x={size - 10}
            y={size - 10}
            textAnchor="end"
            fontFamily='"VT323", "Courier New", monospace'
            fontSize={Math.round(size * 0.07)}
            fill="rgba(255,255,255,0.5)"
            letterSpacing="0.18em"
          >
            {initials.slice(0, 2).toUpperCase()}
          </text>
        )}
      </svg>
    </div>
  );
}

/* ── Deterministic fingerprint generator ───────────────────────────── */

interface Fingerprint {
  pathA: string;
  pathB: string;
  pathC: string;
}

function buildFingerprint(seedStr: string, size: number): Fingerprint {
  const h = fnv1a(seedStr);
  const rng = mulberry32(h);

  const ampA = 8 + rng() * 18;          // 8–26 px
  const freqA = 2 + Math.floor(rng() * 3); // 2–4 cycles
  const phaseA = rng() * Math.PI * 2;
  const yA = size * (0.34 + rng() * 0.10);

  const ampB = 5 + rng() * 14;
  const freqB = 3 + Math.floor(rng() * 3);
  const phaseB = rng() * Math.PI * 2;
  const yB = size * (0.5 + rng() * 0.08);

  const ampC = 4 + rng() * 10;
  const freqC = 2 + Math.floor(rng() * 2);
  const phaseC = rng() * Math.PI * 2;
  const yC = size * (0.7 + rng() * 0.10);

  return {
    pathA: sinePath(size, yA, ampA, freqA, phaseA),
    pathB: sinePath(size, yB, ampB, freqB, phaseB),
    pathC: sinePath(size, yC, ampC, freqC, phaseC),
  };
}

function sinePath(
  size: number,
  baseY: number,
  amp: number,
  cycles: number,
  phase: number,
): string {
  const step = size / 60;
  let d = "";
  for (let x = 0; x <= size; x += step) {
    const y = baseY + Math.sin((x / size) * cycles * Math.PI * 2 + phase) * amp;
    d += (x === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
  }
  return d;
}

/** FNV-1a 32-bit. Stable across runtimes. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
