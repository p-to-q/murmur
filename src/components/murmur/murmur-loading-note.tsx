"use client";

import { FloatingMusicNotes } from "@/components/murmur/floating-music-notes";

const sizes = {
  xs: 18,
  sm: 24,
  md: 34,
  page: 116,
} as const;

const tones = {
  default: "#FF5924",
  muted: "#B6B0A4",
  light: "#FFFEFB",
  ink: "#1A1A1A",
} as const;

type MurmurLoadingNoteProps = {
  className?: string;
  decorative?: boolean;
  size?: keyof typeof sizes;
  tone?: keyof typeof tones;
};

export function MurmurLoadingNote({
  className = "",
  decorative = true,
  size = "sm",
  tone = "default",
}: MurmurLoadingNoteProps) {
  return (
    <FloatingMusicNotes
      className={className}
      color={tones[tone]}
      decorative={decorative}
      size={sizes[size]}
    />
  );
}
