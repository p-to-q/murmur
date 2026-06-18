"use client";

import { FloatingMusicNotes } from "@/components/murmur/floating-music-notes";

type MusicNoteLoaderProps = {
  label: string;
  size?: number;
  className?: string;
};

export function MusicNoteLoader({
  label,
  size = 120,
  className = "",
}: MusicNoteLoaderProps) {
  return (
    <div
      className={`flex items-center justify-center ${className}`.trim()}
      role="status"
      aria-label={label}
    >
      <FloatingMusicNotes size={size} className="opacity-35" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
