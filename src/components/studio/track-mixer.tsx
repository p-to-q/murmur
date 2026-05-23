"use client";
import { motion } from "framer-motion";
import type { ArrangementState, TrackState } from "@/modules/shared/types";
import { useTranslator } from "@/lib/i18n";
import type { TKey } from "@/lib/i18n/dict";

const TRACKS: Array<{ key: keyof ArrangementState; labelKey: TKey; icon: string; color: string }> = [
  { key: "melody",  labelKey: "track.melody",  icon: "♩", color: "#E9A06D" },
  { key: "chords",  labelKey: "track.chords",  icon: "♫", color: "#A7B8C8" },
  { key: "strings", labelKey: "track.strings", icon: "≋", color: "#C9B6E4" },
  { key: "bass",    labelKey: "track.bass",    icon: "◎", color: "#8B8680" },
  { key: "drums",   labelKey: "track.drums",   icon: "▣", color: "#E9A06D" },
  { key: "texture", labelKey: "track.texture", icon: "∿", color: "#A7B8C8" },
];

export interface TrackMixerProps {
  arrangement: ArrangementState;
  onTrack: (key: keyof ArrangementState, patch: Partial<TrackState>) => void;
}

export function TrackMixer({ arrangement, onTrack }: TrackMixerProps) {
  const t = useTranslator();

  return (
    <div
      className="bg-[#FFFDF8] rounded-2xl p-5"
      style={{ boxShadow: "0 2px 12px rgba(34,48,58,0.06)" }}
    >
      <p className="text-[#8B8680] text-xs font-medium tracking-wider uppercase mb-4">
        {t("studio.mixer")}
      </p>
      <div className="space-y-5">
        {TRACKS.map(({ key, labelKey, icon, color }) => {
          const track = arrangement[key];
          return (
            <SliderRow
              key={key}
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
      <p className="text-[#8B8680] text-[11px] mt-4 leading-relaxed">
        {t("studio.mixer.help")}
      </p>
    </div>
  );
}

function SliderRow({
  track, label, icon, color, onChange, onToggle,
}: {
  track: TrackState;
  label: string;
  icon: string;
  color: string;
  onChange: (v: number) => void;
  onToggle: () => void;
}) {
  const pct = Math.round(track.intensity * 100);
  const isOff = !track.enabled || track.intensity === 0;

  return (
    <div className={`flex items-center gap-3 transition-opacity ${isOff ? "opacity-45" : ""}`}>
      <button
        onClick={onToggle}
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors flex-shrink-0 ${
          track.enabled ? "bg-[#F0EAE0] text-[#22303A]" : "bg-[#E8E2D9] text-[#8B8680]"
        }`}
        aria-label={`Toggle ${label}`}
      >
        {icon}
      </button>

      <div className="w-12 flex-shrink-0">
        <p className="text-[#22303A] text-xs font-medium leading-tight">{label}</p>
        <p className="text-[#8B8680] text-[10px]">{isOff ? "—" : `${pct}%`}</p>
      </div>

      <div className="flex-1 relative">
        <div className="h-6 flex items-center">
          <div className="relative w-full h-1.5 bg-[#E8E2D9] rounded-full">
            <motion.div
              className="absolute left-0 top-0 h-full rounded-full"
              style={{ background: track.enabled ? color : "#E8E2D9" }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.15 }}
            />
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={pct}
              onChange={(e) => onChange(parseInt(e.target.value, 10) / 100)}
              className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
              style={{ WebkitAppearance: "none" }}
              aria-label={label}
            />
            <motion.div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md"
              style={{
                left: `calc(${pct}% - 8px)`,
                background: track.enabled ? color : "#E8E2D9",
              }}
              animate={{ left: `calc(${pct}% - 8px)` }}
              transition={{ duration: 0.1 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
