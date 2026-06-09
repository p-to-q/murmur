"use client";

import { useEffect, useRef } from "react";
import { mulberry32, hashString } from "@/lib/utils/seeded-random";
import { VIBE_PRESETS } from "@/presets/vibes";

interface CanvasCoverArtProps {
  songId: string;
  vibe: string;
  className?: string;
}

function parseGradientColors(gradient: string): [number, number, number][] {
  const hexes = gradient.match(/#[0-9A-Fa-f]{6}/g) || [];
  return hexes.map((hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]);
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function CanvasCoverArt({ songId, vibe, className }: CanvasCoverArtProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = 400;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const seed = hashString(songId);
    const rand = mulberry32(seed);

    const vibePreset = VIBE_PRESETS.find((v) => v.id === vibe) || VIBE_PRESETS[0];
    const colors = parseGradientColors(vibePreset.gradient);
    if (colors.length < 2) return;

    // Background — warm cream, slightly randomized
    const bgWarmth = rand();
    const bg = lerpColor([245, 241, 235], [255, 249, 240], bgWarmth);
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    ctx.fillRect(0, 0, size, size);

    // Layer 1: Large soft aurora blobs (radial gradients, no filter needed)
    const numBlobs = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < numBlobs; i++) {
      const colorIdx = Math.floor(rand() * colors.length);
      const color = colors[colorIdx];
      const cx = rand() * size;
      const cy = rand() * size;
      const radius = size * (0.25 + rand() * 0.3);
      const opacity = 0.25 + rand() * 0.35;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${opacity})`);
      grad.addColorStop(0.6, `rgba(${color[0]},${color[1]},${color[2]},${opacity * 0.4})`);
      grad.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }

    // Layer 2: Smaller accent blobs for depth
    const numAccent = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < numAccent; i++) {
      const midColor = lerpColor(colors[0], colors[colors.length - 1], rand());
      const cx = size * (0.2 + rand() * 0.6);
      const cy = size * (0.2 + rand() * 0.6);
      const radius = size * (0.1 + rand() * 0.15);
      const opacity = 0.4 + rand() * 0.3;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(${midColor[0]},${midColor[1]},${midColor[2]},${opacity})`);
      grad.addColorStop(1, `rgba(${midColor[0]},${midColor[1]},${midColor[2]},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }

    // Layer 3: Geometric accent (vinyl-ring, arcs, or dots)
    const geoRoll = rand();
    const geoColor = colors[Math.floor(rand() * colors.length)];
    const geoAlpha = 0.12 + rand() * 0.15;
    ctx.strokeStyle = `rgba(${geoColor[0]},${geoColor[1]},${geoColor[2]},${geoAlpha})`;
    ctx.lineWidth = 1.2;

    if (geoRoll < 0.4) {
      // Thin circle (vinyl ring echo)
      const r = size * (0.2 + rand() * 0.25);
      const cx = size * (0.25 + rand() * 0.5);
      const cy = size * (0.25 + rand() * 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (geoRoll < 0.7) {
      // Parallel arcs (sound wave suggestion)
      const baseY = size * (0.3 + rand() * 0.4);
      const arcCount = 3 + Math.floor(rand() * 3);
      for (let i = 0; i < arcCount; i++) {
        const y = baseY + i * (size * 0.06);
        ctx.beginPath();
        ctx.moveTo(size * 0.15, y);
        ctx.quadraticCurveTo(
          size * 0.5,
          y + (rand() - 0.5) * size * 0.15,
          size * 0.85,
          y,
        );
        ctx.stroke();
      }
    } else {
      // Scattered dots
      const dotCount = 5 + Math.floor(rand() * 8);
      ctx.fillStyle = `rgba(${geoColor[0]},${geoColor[1]},${geoColor[2]},${geoAlpha + 0.05})`;
      for (let i = 0; i < dotCount; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const r = 1.5 + rand() * 2.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [songId, vibe]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
