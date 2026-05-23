"use client";
import { motion } from "framer-motion";
import type { ArrangementState, TrackState } from "@/modules/shared/types";
import { useTranslator } from "@/lib/i18n";
import type { TKey } from "@/lib/i18n/dict";

const TRACKS: Array<{ key: keyof ArrangementState; labelKey: TKey; icon: string; color: string }> = [
  { key: "melody",  labelKey: "track.melody",  icon: "♩", color: "#FF5924" },
  { key: "chords",  labelKey: "track.chords",  icon: "♫", color: "#A7B8C8" },
  { key: "strings", labelKey: "track.strings", icon: "≋", color: "#C9B6E4" },
  { key: "bass",    labelKey: "track.bass",    icon: "◎", color: "#8C8780" },
  { key: "drums",   labelKey: "track.drums",   icon: "▣", color: "#FF5924" },
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
      className="rounded-[28px] border border-[#E9E1D4] bg-[linear-gradient(180deg,rgba(255,254,251,0.98),rgba(247,241,232,0.98))] p-5 shadow-[0_16px_42px_rgba(26,26,26,0.05)] md:p-6"
    >
      <p className="eyebrow mb-2 text-[#FF8A5C]">
        {t("studio.mixer")}
      </p>
      <h3 className="font-serif text-[24px] leading-[1.02] text-[#1A1A1A] md:text-[30px]">
        {t("studio.mix.title")}
      </h3>
      <p className="mt-3 max-w-[34rem] text-[13px] leading-[1.6] text-[#6F6A63] md:text-[14px]">
        {t("studio.mix.sub")}
      </p>
      <div className="mt-6 space-y-5">
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
      <p className="mt-5 text-[11px] leading-relaxed text-[#8C8780]">
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
          track.enabled ? "bg-[#EFE8DA] text-[#1A1A1A]" : "bg-[#E5DDD0] text-[#8C8780]"
        }`}
        aria-label={`Toggle ${label}`}
      >
        {icon}
      </button>

      <div className="w-12 flex-shrink-0">
        <p className="text-[#1A1A1A] text-xs font-medium leading-tight">{label}</p>
        <p className="text-[#8C8780] text-[10px]">{isOff ? "—" : `${pct}%`}</p>
      </div>

      <div className="flex-1 relative">
        <div className="h-6 flex items-center">
          <div className="relative w-full h-1.5 bg-[#E5DDD0] rounded-full">
            <motion.div
              className="absolute left-0 top-0 h-full rounded-full"
              style={{ background: track.enabled ? color : "#E5DDD0" }}
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
                background: track.enabled ? color : "#E5DDD0",
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
