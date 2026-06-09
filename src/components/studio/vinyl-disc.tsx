"use client";

import { motion } from "framer-motion";

export interface VinylDiscProps {
  /** Whether the disc is "playing" (inserted + spinning) */
  isPlaying: boolean;
  /** Accent color for the label ring (hex) */
  accent?: string;
  /** Disc diameter in px */
  size?: number;
  className?: string;
}

/**
 * Dieter Rams–inspired vinyl disc.
 *
 * Two states:
 *  • Idle  — disc floats above the slot opening (translateY offset)
 *  • Play  — disc drops into the slot and spins continuously
 *
 * The parent positions this so that the top portion protrudes above
 * the panel frame, creating a semicircle silhouette.
 */

const DISC_BG = "#1E1A15";
const SPINDLE = "#4A4540";
const SPINDLE_RING = "#3A3530";

export function VinylDisc({
  isPlaying,
  accent = "#FF8A5C",
  size = 92,
  className = "",
}: VinylDiscProps) {
  const spindleSize = Math.round(size * 0.085);
  const spindleRingSize = Math.round(size * 0.15);

  return (
    <motion.div
      className={className}
      initial={false}
      animate={
        isPlaying
          ? { y: 0 }
          : { y: [-20, -24, -20] }
      }
      transition={
        isPlaying
          ? { duration: 0.55, ease: [0.22, 1, 0.36, 1] }
          : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }
      }
    >
      <motion.div
        initial={false}
        animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
        transition={
          isPlaying
            ? { duration: 2.6, repeat: Infinity, ease: "linear" }
            : { duration: 0.7, ease: [0.22, 1, 0.36, 1] }
        }
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          position: "relative",
          background: [
            /* Fine concentric groove texture */
            `repeating-radial-gradient(circle,
              transparent 0px, transparent 2.4px,
              rgba(255,255,255,0.016) 2.4px, rgba(255,255,255,0.016) 3.2px)`,
            /* Label ring + body gradient */
            `radial-gradient(circle,
              ${SPINDLE_RING} 0%, ${SPINDLE_RING} 10%,
              ${accent}30 11%, ${accent}15 24%,
              ${DISC_BG} 25%,
              #1B1815 46%,
              #201D18 47%,
              ${DISC_BG} 100%)`,
          ].join(", "),
          border: "1px solid rgba(255,255,255,0.035)",
          boxShadow: [
            "0 3px 14px rgba(0,0,0,0.4)",
            "0 1px 3px rgba(0,0,0,0.25)",
            "inset 0 0 0 1px rgba(0,0,0,0.15)",
          ].join(", "),
        }}
      >
        {/* Spindle ring */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: spindleRingSize,
            height: spindleRingSize,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${SPINDLE} 0%, ${SPINDLE_RING} 100%)`,
            boxShadow: "0 0 0 1px rgba(255,255,255,0.05)",
          }}
        />
        {/* Center spindle dot */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: spindleSize,
            height: spindleSize,
            borderRadius: "50%",
            background: `radial-gradient(circle at 40% 35%, #6A6258 0%, ${SPINDLE} 100%)`,
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)",
          }}
        />
      </motion.div>
    </motion.div>
  );
}
