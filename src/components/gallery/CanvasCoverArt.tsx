"use client";

import { useEffect, useRef } from "react";
import { mulberry32, hashString } from "@/lib/utils/seeded-random";
import { VIBE_PRESETS } from "@/presets/vibes";

interface CanvasCoverArtProps {
  songId: string;
  /**
   * The song's stored visualConfig gradient — the same string the detail
   * page feeds to SongVisualCanvas. When present, the cover is a faithful
   * still of what the user sees after tapping in.
   */
  gradient?: string;
  /** Legacy fallback: resolve a preset gradient by vibe id. */
  vibe?: string;
  className?: string;
}

/**
 * CanvasCoverArt — a static frame of the song detail visual.
 *
 * Paints exactly what SongVisualCanvas shows at rest: the song's gradient
 * laid diagonally between its first and last color, with a few drifting
 * white particles (seeded by songId so each cover is stable). Covers used
 * to be random aurora blobs that shared nothing with the detail page; now
 * the card is a thumbnail of the page it opens.
 */

function parseHexes(gradient: string): [number, number, number][] {
  const hexes = gradient.match(/#[0-9A-Fa-f]{6}/g) || [];
  return hexes.map((hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]);
}

function resolveGradient(gradient?: string, vibe?: string): string {
  if (gradient && /#[0-9A-Fa-f]{6}/.test(gradient)) return gradient;
  const preset = VIBE_PRESETS.find((v) => v.id === vibe) ?? VIBE_PRESETS[0];
  return preset.gradient;
}

export function CanvasCoverArt({ songId, gradient, vibe, className }: CanvasCoverArtProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = 400;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const colors = parseHexes(resolveGradient(gradient, vibe));
    if (colors.length === 0) return;
    const first = colors[0]!;
    const last = colors[colors.length - 1]!;

    // Base — same composition as SongVisualCanvas at rest: a diagonal
    // gradient from the first to the last color of the stored gradient.
    const base = ctx.createLinearGradient(0, 0, size, size);
    base.addColorStop(0, `rgb(${first[0]},${first[1]},${first[2]})`);
    base.addColorStop(1, `rgb(${last[0]},${last[1]},${last[2]})`);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    // Drifting particles — the idle field, frozen. Seeded per song.
    const rand = mulberry32(hashString(songId));
    const count = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const x = rand() * size;
      // Bias toward the lower half, where the field's risers live.
      const y = size * (0.25 + rand() * 0.75);
      const r = 1.5 + rand() * 4;
      const alpha = 0.12 + rand() * 0.38;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
    }
  }, [songId, gradient, vibe]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
