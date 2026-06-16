"use client";

import { useState } from "react";
import { useInView } from "react-intersection-observer";
import { motion } from "framer-motion";
import { CanvasCoverArt } from "./CanvasCoverArt";
import { mulberry32, hashString } from "@/lib/utils/seeded-random";

export interface SongCardProps {
  id: string;
  title: string;
  vibe: string;
  /** The song's stored visualConfig gradient — keeps the cover in sync
   *  with the detail page this card opens. */
  gradient?: string;
  bpm?: number;
  createdAt: string;
  index: number;
  onClick: () => void;
  /** When provided, shows a corner delete affordance on the cover. */
  onDelete?: () => void;
}

const entryVariants = {
  hidden: { opacity: 0, scale: 0.82, y: 18 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 380,
      damping: 28,
      delay: i * 0.06,
    },
  }),
};

const labelVariants = {
  hidden: { opacity: 0, scale: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 420,
      damping: 22,
      delay: i * 0.06 + 0.15,
    },
  }),
};

export function SongCard({
  id,
  title,
  vibe,
  gradient,
  bpm,
  index,
  onClick,
  onDelete,
}: SongCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const { ref, inView } = useInView({ threshold: 0.1, triggerOnce: true });

  // Seeded rotation for sticker feel
  const seed = hashString(id);
  const rand = mulberry32(seed);
  const labelRotation = (rand() - 0.5) * 4; // -2 to 2 degrees

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
        onClick={onClick}
        whileHover={{ y: -6, transition: { type: "spring", stiffness: 400, damping: 25 } }}
        whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
        className="group relative block w-full text-left"
      >
        {/* Cover — 1:1 square */}
        <div className="relative overflow-hidden rounded-[20px] aspect-square bg-[#F5F1EB]">
          {inView ? (
            <CanvasCoverArt songId={id} gradient={gradient} vibe={vibe} className="w-full h-full" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-r from-[#ECE5D6] via-[#F5F1EB] to-[#ECE5D6] animate-shimmer" />
          )}

          {/* Cover zoom on hover */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            animate={{ scale: isHovered ? 1.04 : 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          />

          {/* Sticker label — text-contour white outline, overlapping bottom of cover */}
          <motion.div
            custom={index}
            variants={labelVariants}
            initial="hidden"
            animate={inView ? "visible" : "hidden"}
            className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-center"
            style={{ transform: `rotate(${labelRotation}deg)` }}
          >
            <span
              className="font-serif-italic text-[#1A1A1A] text-[15px] md:text-[17px] leading-tight line-clamp-2 break-words text-center px-2"
              style={{
                WebkitTextStroke: "6px white",
                paintOrder: "stroke fill",
                filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.10)) blur(0.3px)",
              } as React.CSSProperties}
            >
              {title}
            </span>
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
            onDelete();
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
}
