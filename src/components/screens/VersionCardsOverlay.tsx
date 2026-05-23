"use client";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause } from "lucide-react";
import { toast } from "sonner";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { useTranslator } from "@/lib/i18n";
import { synth } from "@/lib/music/simple-synth";
import type { VibeVersion } from "@/modules/shared/types";

export function VersionCardsOverlay() {
  const {
    vibeVersions,
    recordingState,
    setCurrentVersion,
    resetFlow,
    setRecordingState,
    auditioningVersionId,
    setAuditioning,
  } = useMurmurStore();
  const router = useRouter();
  const t = useTranslator();
  const isVisible = recordingState === "done" && vibeVersions.length > 0;

  const handleSelect = (version: VibeVersion) => {
    synth.stop();
    setCurrentVersion(version);
    router.push("/studio");
  };

  const handleDismiss = () => {
    synth.stop();
    setAuditioning(null);
    resetFlow();
    setRecordingState("idle");
  };

  const handlePlay = (version: VibeVersion) => {
    if (auditioningVersionId === version.id) {
      synth.stop();
      setAuditioning(null);
      return;
    }

    try {
      synth.stop();
      setAuditioning(version.id);
      synth.play(version);
    } catch (err) {
      console.error("[VersionCards] play error:", err);
      toast.error(t("cards.play_error"));
      setAuditioning(null);
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-50 bg-[#F7F3EA] flex flex-col"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="flex-1 overflow-y-auto px-5 pb-24 md:pl-[260px]"
            style={{
              paddingTop: "max(env(safe-area-inset-top, 0px), 36px)",
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-9 text-center"
            >
              <p className="eyebrow mb-3">{t("cards.eyebrow")}</p>
              <h2
                className="font-serif-italic text-[#22303A] text-[34px] md:text-[44px] leading-[1.05] tracking-[-0.018em]"
                style={{ fontWeight: 500 }}
              >
                {t("cards.headline")}
              </h2>
            </motion.div>

            <div className="flex flex-col gap-3.5 max-w-md mx-auto">
              {vibeVersions.map((version, i) => (
                <motion.div
                  key={version.id}
                  initial={{ opacity: 0, y: 24, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{
                    delay: 0.12 + i * 0.09,
                    duration: 0.38,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <VibeCard
                    version={version}
                    isPlaying={auditioningVersionId === version.id}
                    onPlay={handlePlay}
                    onSelect={handleSelect}
                    chooseLabel={t("cards.choose")}
                  />
                </motion.div>
              ))}
            </div>

            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              onClick={handleDismiss}
              className="w-full mt-6 text-center text-[#8B8680] text-sm py-3 hover:text-[#22303A] transition-colors"
            >
              {t("cards.redo")}
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function VibeCard({
  version,
  isPlaying,
  onPlay,
  onSelect,
  chooseLabel,
}: {
  version: VibeVersion;
  isPlaying: boolean;
  onPlay: (v: VibeVersion) => void;
  onSelect: (v: VibeVersion) => void;
  chooseLabel: string;
}) {
  return (
    <motion.div
      className="relative rounded-2xl overflow-hidden"
      style={{
        background: version.visualConfig.gradient,
        minHeight: 130,
        boxShadow: "0 4px 20px rgba(34,48,58,0.10)",
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-black/35 via-black/10 to-transparent" />

      <div className="relative flex items-center p-5 gap-3">
        <div className="flex-1">
          <p className="text-white/65 text-[10px] font-medium tracking-[0.24em] uppercase mb-1.5">
            {version.vibe}
          </p>
          <h3
            className="font-serif text-white text-[22px] leading-tight mb-2.5"
            style={{ fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            {version.title}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {version.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-white/75 text-xs bg-white/15 backdrop-blur-sm rounded-full px-2.5 py-0.5"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={(e) => {
              e.stopPropagation();
              onPlay(version);
            }}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="w-11 h-11 rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center border border-white/30"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 text-white" fill="white" />
            ) : (
              <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
            )}
          </motion.button>

          <button
            onClick={() => onSelect(version)}
            className="text-white/85 text-[11px] font-medium bg-white/25 rounded-full px-3 py-1 hover:bg-white/35 transition-colors"
          >
            {chooseLabel}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
