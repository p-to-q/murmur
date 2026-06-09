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
  bpm?: number;
  createdAt: string;
  index: number;
  onClick: () => void;
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
  bpm,
  index,
  onClick,
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
            <CanvasCoverArt songId={id} vibe={vibe} className="w-full h-full" />
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
            className="absolute bottom-2.5 left-2.5 right-2.5"
            style={{ transform: `rotate(${labelRotation}deg)` }}
          >
            <span
              className="font-serif-italic text-[#1A1A1A] text-[15px] md:text-[17px] leading-tight line-clamp-2 break-words"
              style={{
                WebkitTextStroke: "4px white",
                paintOrder: "stroke fill",
                filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.10))",
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
    </motion.div>
  );
}
