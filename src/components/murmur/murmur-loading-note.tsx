"use client";

import { FloatingMusicNotes } from "@/components/murmur/floating-music-notes";

type MurmurLoadingNoteProps = {
  className?: string;
  decorative?: boolean;
};

export function MurmurLoadingNote({
  className = "",
  decorative = true,
}: MurmurLoadingNoteProps) {
  return (
    <FloatingMusicNotes
      className={`opacity-20 ${className}`.trim()}
      color="#FF5924"
      decorative={decorative}
      size={116}
    />
  );
}
