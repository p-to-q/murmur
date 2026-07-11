"use client";

import { memo, useMemo, useState } from "react";
import { useInView } from "react-intersection-observer";
import { motion, useReducedMotion } from "framer-motion";
import { CanvasCoverArt } from "./CanvasCoverArt";
import { mulberry32, hashString } from "@/lib/music/seeded-random";
import type { VisualArtwork } from "@/modules/shared/types";

export interface SongCardProps {
  id: string;
  title: string;
  vibe: string;
  /** The song's stored visualConfig gradient — keeps the cover in sync
   *  with the detail page this card opens. */
  gradient?: string;
  artwork?: VisualArtwork;
  bpm?: number;
  createdAt: string;
  index: number;
  /** Receives the song id so parents can pass one stable handler to every
   *  card — inline per-card closures would defeat the React.memo below. */
  onClick: (id: string) => void;
  /** When provided, shows a corner delete affordance on the cover. */
  onDelete?: (id: string) => void;
}

function makeEntryVariants(reduceMotion: boolean | null) {
  return {
    hidden: { opacity: 0, scale: reduceMotion ? 1 : 0.82, y: reduceMotion ? 0 : 18 },
    visible: (i: number) => ({
      opacity: 1,
      scale: 1,
      y: 0,
      transition: reduceMotion
        ? { duration: 0.15, delay: i * 0.02 }
        : { type: "spring" as const, stiffness: 380, damping: 28, delay: i * 0.06 },
    }),
  };
}

function makeLabelVariants(reduceMotion: boolean | null) {
  return {
    hidden: { opacity: 0, scale: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 8 },
    visible: (i: number) => ({
      opacity: 1,
      scale: 1,
      y: 0,
      transition: reduceMotion
        ? { duration: 0.15, delay: i * 0.02 + 0.05 }
        : { type: "spring" as const, stiffness: 420, damping: 22, delay: i * 0.06 + 0.15 },
    }),
  };
}

function splitTitleForCover(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);

  if (words.length <= 1 || title.length <= 18) {
    return [title];
  }

  const midpoint = title.length / 2;
  let bestSplit = 1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 1; i < words.length; i += 1) {
    const firstLineLength = words.slice(0, i).join(" ").length;
    const distance = Math.abs(firstLineLength - midpoint);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestSplit = i;
    }
  }

  return [words.slice(0, bestSplit).join(" "), words.slice(bestSplit).join(" ")];
}

export const SongCard = memo(function SongCard({
  id,
  title,
  vibe,
  gradient,
  artwork,
  bpm,
  index,
  onClick,
  onDelete,
}: SongCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const reduceMotion = useReducedMotion();

  const { ref, inView } = useInView({ threshold: 0.1, triggerOnce: true });

  // Seeded rotation for sticker feel — memoize hash + RNG
  const labelRotation = useMemo(() => {
    const seed = hashString(id);
    const rand = mulberry32(seed);
    return (rand() - 0.5) * 4; // -2 to 2 degrees
  }, [id]);
  const titleLines = useMemo(() => splitTitleForCover(title), [title]);
  const entryVariants = useMemo(() => makeEntryVariants(reduceMotion), [reduceMotion]);
  const labelVariants = useMemo(() => makeLabelVariants(reduceMotion), [reduceMotion]);

  return (
    <motion.div
      ref={ref}
      custom={index}
      variants={entryVariants}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      className="relative group"
    >
      <motion.button
        onHoverStart={() => setIsHovered(true)}
        onHoverEnd={() => setIsHovered(false)}
        onClick={() => onClick(id)}
        whileHover={reduceMotion ? undefined : { y: -6, transition: { type: "spring", stiffness: 400, damping: 25 } }}
        whileTap={reduceMotion ? undefined : { scale: 0.97, transition: { duration: 0.1 } }}
        className="group relative block w-full text-left"
      >
        {/* Cover — rounded square with record-label detail */}
        <div className="relative overflow-hidden rounded-[20px] aspect-square bg-[#F5F1EB] shadow-[0_16px_32px_rgba(26,26,26,0.14)] ring-1 ring-[#1A1A1A]/[0.06]">
          {inView ? (
            <CanvasCoverArt
              songId={id}
              gradient={gradient}
              vibe={vibe}
              artwork={artwork}
              className="w-full h-full"
            />
          ) : (
            <div className="absolute inset-0 rounded-[20px] bg-gradient-to-r from-[#ECE5D6] via-[#F5F1EB] to-[#ECE5D6] animate-shimmer" />
          )}

          {/* Cover zoom on hover */}
          <motion.div
            className="absolute inset-0 rounded-[20px] pointer-events-none ring-1 ring-white/35"
            animate={{ scale: isHovered ? 1.035 : 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          />

          <div className="absolute inset-[42%] rounded-full bg-[#F5F1EB]/70 shadow-[inset_0_1px_5px_rgba(26,26,26,0.16)] ring-1 ring-[#1A1A1A]/10 backdrop-blur-[1px]" />
          <div className="absolute inset-[48.5%] rounded-full bg-[#1A1A1A]/20" />

          {/* Sticker label — text-contour white outline, overlapping bottom of record */}
          <motion.div
            custom={index}
            variants={labelVariants}
            initial="hidden"
            animate={inView ? "visible" : "hidden"}
            className="absolute bottom-3 left-3 right-3 flex items-center justify-center"
            style={{ transform: `rotate(${labelRotation}deg)` }}
          >
            <svg
              aria-label={title}
              className="h-[42px] w-full overflow-visible px-2 drop-shadow-[0_1px_3px_rgba(0,0,0,0.10)]"
              role="img"
              viewBox="0 0 260 48"
            >
              {titleLines.map((line, lineIndex) => {
                const isMultiLine = titleLines.length > 1;
                const y = isMultiLine ? 18 + lineIndex * 20 : 29;
                const fontSize = isMultiLine ? 17 : 20;

                return (
                  <text
                    key={`${line}-${lineIndex}`}
                    className="font-serif-italic"
                    dominantBaseline="middle"
                    fill="#1A1A1A"
                    fontSize={fontSize}
                    paintOrder="stroke fill"
                    stroke="rgba(255,255,255,0.96)"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeWidth="6"
                    textAnchor="middle"
                    x="130"
                    y={y}
                  >
                    {line}
                  </text>
                );
              })}
            </svg>
          </motion.div>
        </div>

        {/* Meta — below card */}
        <div className="mt-2 px-0.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[#B7AEA1] truncate">
            {vibe}
            {bpm ? ` · ${bpm} BPM` : ""}
          </p>
        </div>
      </motion.button>

      {/* Delete — sibling of the card button (buttons can't nest), floated
          over the cover corner. Hover-revealed on pointer devices, softly
          visible on touch. */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(id);
          }}
          aria-label={`Delete ${title}`}
          className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-[#1A1A1A]/35 text-white/90 backdrop-blur-sm transition-all hover:bg-[#1A1A1A]/60 opacity-60 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </motion.div>
  );
});
