"use client";
import { useMemo } from "react";
import Image from "next/image";
import { buildMeshGradient } from "@/components/song-detail/mesh-gradient";
import {
  coverArtworkImageStyle,
  coverBrightnessCompensationStyle,
} from "@/lib/music/cover-visual-treatment";
import type { VisualArtwork } from "@/modules/shared/types";

export function SongVisualCanvas({
  gradient,
  artwork,
}: {
  gradient: string;
  artwork?: VisualArtwork;
}) {
  const artworkPath = artwork?.backgroundImagePath ?? artwork?.imagePath;
  const bgStyle = useMemo(
    () => buildMeshGradient(gradient, artwork?.palette),
    [gradient, artwork?.palette],
  );

  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0" style={bgStyle} />
      {artworkPath && (
        <div className="absolute inset-0 opacity-35">
          <Image
            src={artworkPath}
            alt={artwork?.title ?? ""}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 672px"
            style={coverArtworkImageStyle(artwork)}
          />
        </div>
      )}
      {artworkPath && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={coverBrightnessCompensationStyle}
        />
      )}
    </div>
  );
}
