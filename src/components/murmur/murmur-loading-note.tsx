"use client";

import { cn } from "@/utils/utils";
import { FloatingMusicNotes } from "@/components/murmur/floating-music-notes";

const sizes = {
  xs: { box: "h-4 w-4", note: 32 },
  sm: { box: "h-5 w-5", note: 40 },
  md: { box: "h-8 w-8", note: 64 },
  page: { box: "h-32 w-32 md:h-36 md:w-36", note: 132 },
} as const;

const tones = {
  default: { color: "#FF5924", opacity: "opacity-35" },
  muted: { color: "#8C8780", opacity: "opacity-55" },
  light: { color: "#FFFFFF", opacity: "opacity-85" },
  ink: { color: "#1A1A1A", opacity: "opacity-75" },
} as const;

type MurmurLoadingNoteProps = {
  className?: string;
  decorative?: boolean;
  size?: keyof typeof sizes;
  tone?: keyof typeof tones;
};

export function MurmurLoadingNote({
  className,
  decorative = true,
  size = "sm",
  tone = "default",
}: MurmurLoadingNoteProps) {
  const sizeSpec = sizes[size];
  const toneSpec = tones[tone];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-visible",
        sizeSpec.box,
        className,
      )}
      aria-hidden={decorative}
    >
      <FloatingMusicNotes
        color={toneSpec.color}
        decorative={decorative}
        size={sizeSpec.note}
        className={toneSpec.opacity}
      />
    </span>
  );
}
