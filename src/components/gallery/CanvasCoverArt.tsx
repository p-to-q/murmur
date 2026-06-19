"use client";

import { useMemo } from "react";
import Image from "next/image";
import { VIBE_PRESETS } from "@/presets/vibes";
import { buildMeshGradient } from "@/components/song-detail/mesh-gradient";
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

function cropStyle(artwork?: VisualArtwork): React.CSSProperties | undefined {
  if (!artwork) return undefined;
  const { x, y, scale } = artwork.crop;
  return {
    objectFit: "cover" as const,
    objectPosition: `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`,
    transform: `scale(${Math.max(1, scale)})`,
    transformOrigin: "center center",
  };
}

export function CanvasCoverArt({ gradient, vibe, artwork, className }: CanvasCoverArtProps) {
  const resolved = resolveGradient(gradient, vibe);
  const bgStyle = useMemo(
    () => buildMeshGradient(resolved, artwork?.palette),
    [resolved, artwork?.palette],
  );

  const artworkPath = artwork?.backgroundImagePath ?? artwork?.imagePath;

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <div className="absolute inset-0 rounded-[20px]" style={bgStyle} />
      {artwork && artworkPath && (
        <Image
          src={artworkPath}
          alt={`${artwork.title} by ${artwork.artist}`}
          fill
          sizes="(max-width: 768px) 42vw, (max-width: 1280px) 28vw, 22vw"
          className="absolute inset-0 h-full w-full rounded-[20px] object-cover opacity-35"
          style={cropStyle(artwork)}
        />
      )}
    </div>
  );
}
