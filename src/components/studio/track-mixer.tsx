"use client";
import { motion } from "framer-motion";
import type { ArrangementState, TrackState } from "@/modules/shared/types";
import { useTranslator } from "@/lib/i18n";
import type { TKey } from "@/lib/i18n/dict";

const TRACKS: Array<{
  key: keyof ArrangementState;
  labelKey: TKey;
  letter: string;
  color: string;
}> = [
  { key: "melody",  labelKey: "track.melody",  letter: "M", color: "#FF5924" },
  { key: "chords",  labelKey: "track.chords",  letter: "C", color: "#A7B8C8" },
  { key: "strings", labelKey: "track.strings", letter: "S", color: "#C9B6E4" },
  { key: "bass",    labelKey: "track.bass",    letter: "B", color: "#8C8780" },
  { key: "drums",   labelKey: "track.drums",   letter: "D", color: "#FF5924" },
  { key: "texture", labelKey: "track.texture", letter: "T", color: "#A7B8C8" },
];

export interface TrackMixerProps {
  arrangement: ArrangementState;
  onTrack: (key: keyof ArrangementState, patch: Partial<TrackState>) => void;
  className?: string;
}

export function TrackMixer({ arrangement, onTrack, className = "" }: TrackMixerProps) {
  const t = useTranslator();

  return (
    <div className={`space-y-5 ${className}`}>
      {TRACKS.map(({ key, labelKey, letter, color }) => {
        const track = arrangement[key];
        return (
          <FaderRow
            key={key}
            letter={letter}
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

function FaderRow({
  track,
  label,
  letter,
  color,
  onChange,
  onToggle,
}: {
  track: TrackState;
  label: string;
  letter: string;
  color: string;
  onChange: (v: number) => void;
  onToggle: () => void;
}) {
  const pct = Math.round(track.intensity * 100);
  const isOff = !track.enabled || track.intensity === 0;

  return (
    <div
      className={`flex items-center gap-4 h-14 transition-opacity ${
        isOff ? "opacity-40" : ""
      }`}
    >
      {/* Letter icon — tap to toggle */}
      <button
        onClick={onToggle}
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-medium transition-colors ${
          track.enabled
            ? "bg-[#EFE8DA] text-[#1A1A1A]"
            : "bg-[#E5DDD0] text-[#8C8780] line-through"
        }`}
        aria-label={`Toggle ${label}`}
      >
        {letter}
      </button>

      {/* Track name */}
      <span className="w-16 flex-shrink-0 font-serif-italic text-[13px] text-[#8C8780]">
        {label}
      </span>

      {/* Slider */}
      <div className="flex-1 relative h-6 flex items-center">
        <div className="relative w-full h-1.5 bg-[#E5DDD0] rounded-full">
          {/* Fill */}
          <motion.div
            className="absolute left-0 top-0 h-full rounded-full"
            style={{ background: track.enabled ? color : "#E5DDD0" }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.12 }}
          />
          {/* Native range input (invisible, for accessibility + drag) */}
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
          {/* Thumb */}
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
      </div>

      {/* Percentage */}
      <span className="w-10 text-right text-[12px] tabular-nums text-[#B6B0A4]">
        {isOff ? "—" : `${pct}%`}
      </span>
    </div>
  );
}
