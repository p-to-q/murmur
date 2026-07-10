"use client";

import { motion } from "framer-motion";

export interface TonearmProps {
  isPlaying: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Dieter Rams–inspired tonearm.
 *
 * A single obtuse-angle arm in warm aluminum tones, pivoting at the
 * top-right. Designed to sit at the panel's right edge — the parent's
 * `overflow-hidden` + `rounded-[…]` clips the pivot base, so the arm
 * appears to enter from outside the frame.
 *
 * Idle → arm angled slightly right (lifted).
 * Playing → rotates −16° counter-clockwise (drops onto the platter).
 */

const ALUMINUM = "#AEA798";
const PIVOT_OUTER = "#3A3530";
const PIVOT_INNER = "#4E4840";
const PIVOT_CENTER = "#605850";
const COUNTERWEIGHT = "#2C2822";
const HEADSHELL = "#B8B0A4";
const CARTRIDGE = "#3A3530";

export function Tonearm({ isPlaying, className = "", style }: TonearmProps) {
  return (
    <div className={className} style={style}>
    <motion.svg
      viewBox="0 0 160 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      style={{ transformOrigin: "92.5% 11.7%" }}
      initial={false}
      animate={{ rotate: isPlaying ? -16 : 0 }}
      transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* ── Counterweight ── */}
      <ellipse
        cx="158" cy="35" rx="10" ry="11"
        fill={COUNTERWEIGHT}
        stroke="#3E3830"
        strokeWidth="0.7"
      />

      {/* ── Pivot bearing — concentric rings ── */}
      <circle cx="148" cy="42" r="13" fill={PIVOT_OUTER} />
      <circle cx="148" cy="42" r="8" fill={PIVOT_INNER} />
      <circle cx="148" cy="42" r="3.5" fill={PIVOT_CENTER} />

      {/* ── Arm shaft — obtuse bend at ~150° ── */}
      <path
        d="M 148,42 L 52,220 L 14,252"
        stroke={ALUMINUM}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* ── Headshell ── */}
      <rect
        x="4" y="246" width="16" height="8" rx="1.8"
        fill={HEADSHELL}
        transform="rotate(-32, 12, 250)"
      />

      {/* ── Cartridge ── */}
      <rect
        x="6" y="254" width="9" height="5" rx="1"
        fill={CARTRIDGE}
        transform="rotate(-32, 10.5, 256.5)"
      />

      {/* ── Stylus tip ── */}
      <circle cx="8" cy="261" r="1.2" fill="rgba(255,255,255,0.4)" />
    </motion.svg>
    </div>
  );
}
