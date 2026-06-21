"use client";

import { motion, useReducedMotion } from "framer-motion";

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
  const reduceMotion = useReducedMotion();
  const pulseAnimation = reduceMotion
    ? { scale: 1, opacity: 0.42 }
    : { scale: 1, opacity: 0.5 };
  const pulseTransition = reduceMotion
    ? { duration: 0 }
    : {
        duration: 1.6,
        repeat: Infinity,
        repeatType: "reverse" as const,
        ease: "easeInOut" as const,
      };
  const pathAnimation = reduceMotion ? { pathLength: 1 } : { pathLength: 1 };
  const pathTransition = reduceMotion
    ? { duration: 0 }
    : {
        duration: 1.6,
        repeat: Infinity,
        repeatType: "reverse" as const,
        ease: "easeInOut" as const,
      };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={`block ${className}`.trim()}
      aria-hidden={decorative ? "true" : undefined}
      focusable="false"
    >
      <motion.circle
        initial={reduceMotion ? false : { scale: 0.75, opacity: 0.15 }}
        animate={pulseAnimation}
        transition={pulseTransition}
        cx="60"
        cy="80"
        r="12"
        fill={color}
      />
      <motion.path
        initial={reduceMotion ? false : { pathLength: 0 }}
        animate={pathAnimation}
        transition={pathTransition}
        d="M 72 80 L 72 30 Q 72 20 82 22 L 100 26"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
