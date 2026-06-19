import type { CSSProperties } from "react";
import type { VisualArtwork } from "@/modules/shared/types";

export const COVER_ARTWORK_BRIGHTNESS_FILTER = "brightness(1.18) saturate(1.04) contrast(1.02)";
export const COVER_BRIGHTNESS_COMPENSATION_ALPHA = 0.08;

export const coverBrightnessCompensationStyle: CSSProperties = {
  background: `rgba(255,255,255,${COVER_BRIGHTNESS_COMPENSATION_ALPHA})`,
  mixBlendMode: "screen",
};

export function coverArtworkImageStyle(artwork?: VisualArtwork): CSSProperties | undefined {
  if (!artwork) return undefined;
  const { x = 0.5, y = 0.5, scale = 1 } = artwork.crop ?? {};
  return {
    filter: COVER_ARTWORK_BRIGHTNESS_FILTER,
    objectFit: "cover",
    objectPosition: `${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`,
    transform: `scale(${Math.max(1, scale)})`,
    transformOrigin: "center center",
  };
}

export function applyCoverBrightnessCompensation(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alpha = COVER_BRIGHTNESS_COMPENSATION_ALPHA,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
