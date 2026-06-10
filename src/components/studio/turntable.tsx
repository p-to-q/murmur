"use client";

import { motion } from "framer-motion";

export interface TurntableProps {
  /** Whether the record is spinning with the needle down */
  isPlaying: boolean;
  /** Accent color for the record label (hex) */
  accent?: string;
  className?: string;
}

/**
 * Turntable — record + tonearm as one rigid unit.
 *
 * Replaces the old split layout (disc slotted into the panel, tonearm
 * floating alone in the hero corner) that broke the metaphor: a needle
 * belongs on its record. Every part lives in one wrapper with a fixed
 * aspect ratio and percentage-based geometry, so the needle lands on the
 * same groove at every viewport size — the two pieces can't drift apart
 * again.
 *
 * States:
 *  • Idle — needle parked on its arm rest, record still.
 *  • Play — arm swings in, stylus touches down mid-groove, record spins.
 *
 * Geometry (viewBox 170×134): record center (60,72) r60; pivot (156,16);
 * stylus touches (82,90) when playing, rests at ≈(115,112) when idle
 * (the arm group rotates −22° around the pivot).
 */

const VINYL_BODY = "#1E1A15";
const VINYL_DEEP = "#16130F";
const SPINDLE = "#4A4540";
const SPINDLE_RING = "#3A3530";

/** Pivot position as a fraction of the 170×134 box. */
const PIVOT_ORIGIN = "91.76% 11.94%";
const IDLE_ARM_DEG = -22;

export function Turntable({
  isPlaying,
  accent = "#FF8A5C",
  className = "",
}: TurntableProps) {
  return (
    // Outer div takes the caller's positioning; the inner div provides the
    // positioning context so the layers can never escape the unit.
    <div className={className} style={{ aspectRatio: "170 / 134" }}>
      <div className="relative h-full w-full">
      {/* ── Record — spins around its own center ─────────────────── */}
      <motion.svg
        viewBox="0 0 120 120"
        className="absolute"
        style={{
          left: 0,
          bottom: "1.5%",
          width: "70.6%",
          aspectRatio: "1 / 1",
          transformOrigin: "50% 50%",
          overflow: "visible",
          filter: "drop-shadow(0 3px 12px rgba(0,0,0,0.38))",
        }}
        initial={false}
        animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
        transition={
          isPlaying
            ? { duration: 2.6, repeat: Infinity, ease: "linear" }
            : { duration: 0.7, ease: [0.22, 1, 0.36, 1] }
        }
      >
        <defs>
          <radialGradient id="tt-vinyl-body">
            <stop offset="0%" stopColor={SPINDLE_RING} />
            <stop offset="14%" stopColor={VINYL_BODY} />
            <stop offset="46%" stopColor="#1B1815" />
            <stop offset="47%" stopColor="#201D18" />
            <stop offset="100%" stopColor={VINYL_DEEP} />
          </radialGradient>
        </defs>

        {/* Body + pressed edge */}
        <circle cx="60" cy="60" r="59" fill="url(#tt-vinyl-body)" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        <circle cx="60" cy="60" r="55.5" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1.4" />

        {/* Grooves */}
        {[26, 32, 38, 44, 50].map((r) => (
          <circle key={r} cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="0.8" />
        ))}

        {/* Label — accent tint, like the old slot disc */}
        <circle cx="60" cy="60" r="16" fill={accent} opacity="0.2" />
        <circle cx="60" cy="60" r="16" fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="1" />

        {/* Off-center glints so the spin reads as motion */}
        <circle cx="69" cy="52" r="1.4" fill="rgba(255,255,255,0.32)" />
        <circle cx="52" cy="67" r="1" fill="rgba(255,255,255,0.16)" />

        {/* Spindle */}
        <circle cx="60" cy="60" r="4.5" fill={SPINDLE_RING} stroke="rgba(255,255,255,0.07)" strokeWidth="0.8" />
        <circle cx="60" cy="60" r="2.3" fill={SPINDLE} />
        <circle cx="59.4" cy="59.3" r="0.9" fill="#6A6258" />
      </motion.svg>

      {/* ── Static deck details — pivot base + arm rest ───────────── */}
      <svg viewBox="0 0 170 134" className="absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
        {/* Arm rest — catches the stylus at the idle angle */}
        <line x1="115.1" y1="106.5" x2="115.1" y2="113.8" stroke="rgba(255,255,255,0.28)" strokeWidth="3.2" strokeLinecap="round" />
        {/* Pivot base */}
        <circle cx="156" cy="16" r="7" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      </svg>

      {/* ── Tonearm — rigid assembly rotating around the pivot ────── */}
      <motion.svg
        viewBox="0 0 170 134"
        className="absolute inset-0 h-full w-full"
        style={{ transformOrigin: PIVOT_ORIGIN, overflow: "visible" }}
        initial={false}
        animate={{ rotate: isPlaying ? 0 : IDLE_ARM_DEG }}
        transition={{ type: "spring", stiffness: 150, damping: 17 }}
      >
        {/* Counterweight behind the pivot */}
        <line x1="156" y1="16" x2="164.5" y2="7.5" stroke="rgba(255,255,255,0.5)" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="164.5" cy="7.5" r="4.2" fill="rgba(255,255,255,0.5)" />

        {/* Arm tube */}
        <line x1="156" y1="16" x2="87.7" y2="84.3" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" />

        {/* Headshell */}
        <line x1="87.7" y1="84.3" x2="82" y2="90" stroke="rgba(255,255,255,0.6)" strokeWidth="5" strokeLinecap="round" />

        {/* Stylus — accent glow while it rides the groove */}
        <motion.circle
          cx="82"
          cy="90"
          r="4"
          fill={accent}
          initial={false}
          animate={{ opacity: isPlaying ? 0.45 : 0 }}
          transition={{ duration: 0.4 }}
        />
        <circle cx="82" cy="90" r="1.6" fill="rgba(255,255,255,0.75)" />

        {/* Pivot cap — turns with the arm, above the static base */}
        <circle cx="156" cy="16" r="2.6" fill="rgba(255,255,255,0.4)" />
      </motion.svg>
      </div>
    </div>
  );
}
