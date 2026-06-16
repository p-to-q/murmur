"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { VIBE_PRESETS } from "@/presets/vibes";
import { hashString, mulberry32 } from "@/lib/utils/seeded-random";
import type { VisualArtwork } from "@/modules/shared/types";

interface CanvasCoverArtProps {
  songId: string;
  gradient?: string;
  vibe?: string;
  artwork?: VisualArtwork;
  className?: string;
}

function resolveGradient(gradient?: string, vibe?: string): string {
  if (gradient && /#[0-9A-Fa-f]{6}/.test(gradient)) return gradient;
  const preset = VIBE_PRESETS.find((v) => v.id === vibe) ?? VIBE_PRESETS[0];
  return preset.gradient;
}

type RGB = { r: number; g: number; b: number };

function parseHex(h: string): RGB {
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mixColor(a: RGB, b: RGB, amount: number): RGB {
  return {
    r: clampChannel(a.r + (b.r - a.r) * amount),
    g: clampChannel(a.g + (b.g - a.g) * amount),
    b: clampChannel(a.b + (b.b - a.b) * amount),
  };
}

function rgba(color: RGB, alpha: number): string {
  return `rgba(${color.r},${color.g},${color.b},${alpha})`;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  size: number,
  seed: number,
  colors: RGB[],
) {
  const rand = mulberry32(seed);
  const paper = parseHex("#FFFEFB");
  const ink = parseHex("#1A1A1A");
  const first = colors[0] ?? parseHex("#F4C87A");
  const middle = colors[1] ?? mixColor(first, colors[colors.length - 1] ?? parseHex("#E9A06D"), 0.5);
  const last = colors[colors.length - 1] ?? parseHex("#E9A06D");

  ctx.clearRect(0, 0, size, size);

  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, rgba(mixColor(first, paper, 0.16), 1));
  base.addColorStop(0.48, rgba(middle, 1));
  base.addColorStop(1, rgba(mixColor(last, ink, 0.24), 1));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 4; i++) {
    const wash = ctx.createRadialGradient(
      size * (0.15 + rand() * 0.7),
      size * (0.12 + rand() * 0.72),
      size * 0.02,
      size * (0.15 + rand() * 0.7),
      size * (0.12 + rand() * 0.72),
      size * (0.36 + rand() * 0.34),
    );
    const color = i % 2 === 0 ? paper : mixColor(first, last, rand());
    wash.addColorStop(0, rgba(color, 0.14 + rand() * 0.16));
    wash.addColorStop(0.62, rgba(color, 0.04));
    wash.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, size, size);
  }

  for (let i = 0; i < 420; i++) {
    const dot = rand() > 0.5 ? paper : ink;
    ctx.fillStyle = rgba(dot, rand() * 0.038);
    const dotSize = Math.max(1, size * (0.0013 + rand() * 0.0016));
    ctx.fillRect(rand() * size, rand() * size, dotSize, dotSize);
  }

  const vignette = ctx.createRadialGradient(
    size * 0.52,
    size * 0.46,
    size * 0.1,
    size * 0.52,
    size * 0.46,
    size * 0.78,
  );
  vignette.addColorStop(0.55, rgba(ink, 0));
  vignette.addColorStop(1, rgba(ink, 0.26));
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = rgba(paper, 0.2);
  ctx.lineWidth = Math.max(1, size * 0.004);
  ctx.strokeRect(size * 0.01, size * 0.01, size * 0.98, size * 0.98);
}

function cropStyle(artwork?: VisualArtwork): React.CSSProperties | undefined {
  if (!artwork) return undefined;
  const { x, y, scale } = artwork.crop;
  return {
    objectFit: "cover",
    objectPosition: `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`,
    transform: `scale(${Math.max(1, scale)})`,
    transformOrigin: "center center",
  };
}

export function CanvasCoverArt({ songId, gradient, vibe, artwork, className }: CanvasCoverArtProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loadedArtworkPath, setLoadedArtworkPath] = useState<string | null>(null);
  const artworkReady = !!artwork && loadedArtworkPath === artwork.imagePath;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resolved = resolveGradient(gradient, vibe);
    const hexes = resolved.match(/#[0-9A-Fa-f]{6}/g) ?? ["#F4C87A", "#E9A06D"];
    const colors = hexes.map(parseHex);
    const seed = hashString(`${songId}:${resolved}:${vibe ?? ""}`);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function render() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const size = Math.max(320, Math.ceil(Math.max(rect.width, rect.height) || 420));
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCover(ctx, size, seed, colors);
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);

    return () => observer.disconnect();
  }, [gradient, songId, vibe]);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      {artwork ? (
        <Image
          src={artwork.imagePath}
          alt={`${artwork.title} by ${artwork.artist}`}
          fill
          sizes="(max-width: 768px) 42vw, (max-width: 1280px) 28vw, 22vw"
          className="absolute inset-0 h-full w-full rounded-full transition-opacity duration-500"
          style={{
            ...cropStyle(artwork),
            opacity: artworkReady ? 1 : 0,
          }}
          onLoad={() => setLoadedArtworkPath(artwork.imagePath)}
          onError={() => setLoadedArtworkPath(null)}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full rounded-full"
        style={{
          display: "block",
          mixBlendMode: artworkReady ? "soft-light" : "normal",
          opacity: artworkReady ? 0.58 : 1,
        }}
      />
    </div>
  );
}
