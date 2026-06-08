"use client";
import { motion } from "framer-motion";
import { Music, Piano, Waves, Music2, Drum, Sparkles } from "lucide-react";
import type { ArrangementState, TrackState } from "@/modules/shared/types";
import { useTranslator } from "@/lib/i18n";
import type { TKey } from "@/lib/i18n/dict";
import type React from "react";

const TRACKS: Array<{
  key: keyof ArrangementState;
  labelKey: TKey;
  letter: string;
  icon: React.ReactNode;
  color: string;
}> = [
  {
    key: "melody",
    labelKey: "track.melody",
    letter: "M",
    icon: <Music className="w-4 h-4" />,
    color: "#E8855A"
  },
  {
    key: "chords",
    labelKey: "track.chords",
    letter: "C",
    icon: <Piano className="w-4 h-4" />,
    color: "#B8C4CE"
  },
  {
    key: "strings",
    labelKey: "track.strings",
    letter: "S",
    icon: <Waves className="w-4 h-4" />,
    color: "#C4B4D8"
  },
  {
    key: "bass",
    labelKey: "track.bass",
    letter: "B",
    icon: <Music2 className="w-4 h-4" />,
    color: "#A09880"
  },
  {
    key: "drums",
    labelKey: "track.drums",
    letter: "D",
    icon: <Drum className="w-4 h-4" />,
    color: "#D4784A"
  },
  {
    key: "texture",
    labelKey: "track.texture",
    letter: "T",
    icon: <Sparkles className="w-4 h-4" />,
    color: "#9AAFBA"
  },
];

export interface TrackMixerProps {
  arrangement: ArrangementState;
  onTrack: (key: keyof ArrangementState, patch: Partial<TrackState>) => void;
  className?: string;
  /** "compact" = 3×2 grid | "strings" = 6 guitar-string faders full-width */
  variant?: "default" | "compact" | "strings";
  /** Show stylus needle overlay (strings variant only) */
  isPlaying?: boolean;
}

export function TrackMixer({
  arrangement,
  onTrack,
  className = "",
  variant = "default",
  isPlaying = false,
}: TrackMixerProps) {
  const t = useTranslator();

  if (variant === "strings") {
    return (
      <div className={`${className}`}>
        <div className="flex flex-col gap-1">
          {TRACKS.map(({ key, labelKey, letter, icon, color }) => {
            const track = arrangement[key];
            const label = t(labelKey);
            return (
              <StringFader
                key={key}
                color={color}
                letter={letter}
                icon={icon}
                label={label}
                track={track}
                onChange={(v) =>
                  onTrack(key, {
                    intensity: v,
                    enabled: v > 0,
                    versionHistory: [...track.versionHistory, String(track.intensity)],
                  })
                }
                onToggle={() =>
                  onTrack(key, {
                    enabled: !track.enabled,
                    intensity: !track.enabled ? Math.max(track.intensity, 0.3) : track.intensity,
                  })
                }
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className={`grid grid-cols-3 gap-x-4 gap-y-3 ${className}`}>
        {TRACKS.map(({ key, labelKey, letter, icon, color }) => {
          const track = arrangement[key];
          return (
            <CompactFader
              key={key}
              letter={letter}
              icon={icon}
              color={color}
              label={t(labelKey)}
              track={track}
              onChange={(v) =>
                onTrack(key, {
                  intensity: v,
                  enabled: v > 0,
                  versionHistory: [...track.versionHistory, String(track.intensity)],
                })
              }
              onToggle={() =>
                onTrack(key, {
                  enabled: !track.enabled,
                  intensity: !track.enabled ? Math.max(track.intensity, 0.3) : track.intensity,
                })
              }
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${className}`}>
      {TRACKS.map(({ key, labelKey, letter, icon, color }) => {
        const track = arrangement[key];
        return (
          <FaderRow
            key={key}
            letter={letter}
            icon={icon}
            color={color}
            label={t(labelKey)}
            track={track}
            onChange={(v) =>
              onTrack(key, {
                intensity: v,
                enabled: v > 0,
                versionHistory: [...track.versionHistory, String(track.intensity)],
              })
            }
            onToggle={() =>
              onTrack(key, {
                enabled: !track.enabled,
                intensity: !track.enabled ? Math.max(track.intensity, 0.3) : track.intensity,
              })
            }
          />
        );
      })}
    </div>
  );
}

/* ── Compact fader (3×2 grid, glass-dark) ────────────────────────── */

function CompactFader({
  track,
  letter,
  icon,
  color,
  label,
  onChange,
  onToggle,
}: {
  track: TrackState;
  letter: string;
  icon: React.ReactNode;
  color: string;
  label: string;
  onChange: (v: number) => void;
  onToggle: () => void;
}) {
  const pct = Math.round(track.intensity * 100);
  const isOff = !track.enabled || track.intensity === 0;

  return (
    <div className={`flex items-center gap-2 transition-opacity ${isOff ? "opacity-35" : ""}`}>
      <button
        onClick={onToggle}
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
          track.enabled
            ? "bg-white/20 text-white"
            : "bg-white/8 text-white/40"
        }`}
        style={{ color: track.enabled ? color : undefined }}
        aria-label={`Toggle ${label}`}
      >
        {icon}
      </button>

      <div className="flex-1 relative h-5 flex items-center">
        <div className="relative w-full h-[3px] bg-white/15 rounded-full">
          <motion.div
            className="absolute left-0 top-0 h-full rounded-full"
            style={{ background: track.enabled ? color : "rgba(255,255,255,0.1)" }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.1 }}
          />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => onChange(parseInt(e.target.value, 10) / 100)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            style={{ WebkitAppearance: "none" }}
            aria-label={label}
          />
          <motion.div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border border-white/60 shadow-sm pointer-events-none"
            style={{
              left: `calc(${pct}% - 7px)`,
              background: track.enabled ? "white" : "rgba(255,255,255,0.3)",
            }}
            animate={{ left: `calc(${pct}% - 7px)` }}
            transition={{ duration: 0.06 }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Guitar string fader (strings variant) ───────────────────────── */

function StringFader({
  track,
  color,
  letter,
  icon,
  label,
  onChange,
  onToggle,
}: {
  track: TrackState;
  color: string;
  letter: string;
  icon: React.ReactNode;
  label: string;
  onChange: (v: number) => void;
  onToggle: () => void;
}) {
  const pct = Math.round(track.intensity * 100);
  const isOff = !track.enabled || track.intensity === 0;
  const activeColor = isOff ? "rgba(255,255,255,0.06)" : color;

  return (
    <div className={`transition-opacity ${isOff ? "opacity-35" : ""}`}>
      {/* Main row: icon + groove + percentage */}
      <div className="flex items-center gap-3">
        {/* Icon badge */}
        <button
          onClick={onToggle}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors"
          style={{
            background: track.enabled ? `${color}25` : "rgba(255,255,255,0.05)",
            color: track.enabled ? color : "rgba(255,255,255,0.25)",
          }}
          aria-label={`Toggle ${label}`}
        >
          {icon}
        </button>

        {/* Fader groove container with percentage */}
        <div className="flex-1 relative h-6 flex items-center gap-3">
          {/* Groove wrapper - limited width */}
          <div className="flex-1 relative h-6 flex items-center" style={{ maxWidth: 'calc(100% - 48px)' }}>
            {/* Groove channel — inset, tactile */}
            <div
              className="absolute inset-x-0 h-[5px] rounded-full"
              style={{
                background: "rgba(255,255,255,0.05)",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.25), 0 0.5px 0 rgba(255,255,255,0.04)",
              }}
            />
            {/* Colored fill */}
            <motion.div
              className="absolute left-0 h-[5px] rounded-full"
              style={{ background: activeColor }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.12 }}
            />
            {/* Thumb knob */}
            <motion.div
              className="absolute w-[18px] h-[18px] rounded-full pointer-events-none"
              style={{
                background: track.enabled
                  ? "radial-gradient(circle at 40% 35%, #FFFFFF 0%, #E8E4DF 60%, #D0CBC4 100%)"
                  : "rgba(255,255,255,0.14)",
                boxShadow: track.enabled
                  ? `0 1px 3px rgba(0,0,0,0.35), 0 0 10px 2px ${color}30`
                  : "none",
              }}
              animate={{ left: `calc(${pct}% - 9px)` }}
              transition={{ duration: 0.06 }}
            />
            {/* Invisible range input */}
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={pct}
              onChange={(e) => onChange(parseInt(e.target.value, 10) / 100)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              style={{ WebkitAppearance: "none" }}
              aria-label={label}
            />
          </div>

          {/* Percentage - fixed position on the right */}
          <span
            className="text-[13px] tabular-nums font-semibold flex-shrink-0"
            style={{ color: "rgba(255,255,255,0.4)", minWidth: "42px" }}
          >
            {isOff ? "—" : `${pct}%`}
          </span>
        </div>
      </div>

      {/* Label below the track - much closer */}
      <div className="pl-11 -mt-2">
        <span
          className="text-[11px] font-serif-italic tracking-wide"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

/* ── Standard fader row (default variant) ────────────────────────── */

function FaderRow({
  track,
  label,
  letter,
  icon,
  color,
  onChange,
  onToggle,
}: {
  track: TrackState;
  label: string;
  letter: string;
  icon: React.ReactNode;
  color: string;
  onChange: (v: number) => void;
  onToggle: () => void;
}) {
  const pct = Math.round(track.intensity * 100);
  const isOff = !track.enabled || track.intensity === 0;

  return (
    <div
      className={`flex items-center gap-3 h-14 transition-opacity ${
        isOff ? "opacity-40" : ""
      }`}
    >
      <button
        onClick={onToggle}
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
          track.enabled
            ? "bg-[#EFE8DA]"
            : "bg-[#E5DDD0]"
        }`}
        style={{ color: track.enabled ? color : "#8C8780" }}
        aria-label={`Toggle ${label}`}
      >
        {icon}
      </button>

      <span className="w-16 flex-shrink-0 font-serif-italic text-[13px] text-[#8C8780]">
        {label}
      </span>

      <div className="flex-1 relative h-6 flex items-center pr-12">
        <div className="relative w-full h-1.5 bg-[#E5DDD0] rounded-full">
          <motion.div
            className="absolute left-0 top-0 h-full rounded-full"
            style={{ background: track.enabled ? color : "#E5DDD0" }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.12 }}
          />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => onChange(parseInt(e.target.value, 10) / 100)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            style={{ WebkitAppearance: "none" }}
            aria-label={label}
          />
          <motion.div
            className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white shadow-md pointer-events-none"
            style={{
              left: `calc(${pct}% - 10px)`,
              background: track.enabled ? color : "#E5DDD0",
            }}
            animate={{ left: `calc(${pct}% - 10px)` }}
            transition={{ duration: 0.08 }}
          />
        </div>

        {/* Percentage at the end of track */}
        <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[11px] font-serif-italic tabular-nums text-[#B6B0A4]">
          {isOff ? "—" : `${pct}%`}
        </span>
      </div>
    </div>
  );
}
