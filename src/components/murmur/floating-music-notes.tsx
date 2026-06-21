"use client";

import { motion } from "framer-motion";

interface FloatingMusicNotesProps {
  className?: string;
  color?: string;
  decorative?: boolean;
  size?: number;
}

export function FloatingMusicNotes({
  className = "",
  color = "#FF5924",
  decorative = true,
  size = 160,
}: FloatingMusicNotesProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={`block ${className}`.trim()}
      aria-hidden={decorative}
    >
      <motion.circle
        initial={{ scale: 0.75, opacity: 0.15 }}
        animate={{ scale: 1, opacity: 0.5 }}
        transition={{
          duration: 1.6,
          repeat: Infinity,
          repeatType: "reverse",
          ease: "easeInOut",
        }}
        cx="60"
        cy="80"
        r="12"
        fill={color}
      />
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{
          duration: 1.6,
          repeat: Infinity,
          repeatType: "reverse",
          ease: "easeInOut",
        }}
        d="M 72 80 L 72 30 Q 72 20 82 22 L 100 26"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
