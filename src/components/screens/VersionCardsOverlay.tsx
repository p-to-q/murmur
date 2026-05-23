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
          className="fixed inset-0 z-50 bg-[#F5F1EB] flex flex-col overflow-y-auto"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="flex-1 px-6 md:px-12 pb-28 md:pl-[280px] max-w-6xl w-full"
            style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 56px)" }}
          >
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mb-10 md:mb-14"
            >
              <p className="eyebrow mb-4">{t("cards.eyebrow")}</p>
              <h2 className="hero-serif text-[#1A1A1A] text-[40px] md:text-[64px] max-w-[640px]">
                {t("cards.headline")}
              </h2>
            </motion.div>

            {/* 3 poster-style album cards in a row on desktop */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
              {vibeVersions.map((version, i) => (
                <motion.div
                  key={version.id}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.18 + i * 0.08,
                    duration: 0.45,
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
              className="block mx-auto mt-12 text-[#8C8780] text-[13px] tracking-[0.04em] hover:text-[#1A1A1A] transition-colors underline-mm"
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
    <div className="flex flex-col">
      {/* Album-cover square */}
      <div
        className="relative rounded-[12px] overflow-hidden aspect-square cursor-pointer"
        style={{
          background: version.visualConfig.gradient,
          boxShadow:
            "0 1px 3px rgba(26,26,26,0.06), 0 16px 36px rgba(26,26,26,0.14)",
        }}
        onClick={() => onSelect(version)}
      >
        {/* Grain */}
        <div
          className="absolute inset-0 opacity-[0.10] mix-blend-multiply pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundSize: "160px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/45 pointer-events-none" />

        {/* Bottom-left typographic block */}
        <div className="absolute bottom-5 left-5 right-5 pointer-events-none">
          <p className="text-white/75 text-[10px] tracking-[0.3em] uppercase mb-2">
            {version.vibe}
          </p>
          <h3 className="font-serif text-white text-[26px] leading-[1.05]">
            {version.title}
          </h3>
        </div>

        {/* Center play button */}
        <motion.button
          whileTap={{ scale: 0.92 }}
          whileHover={{ scale: 1.05 }}
          onClick={(e) => {
            e.stopPropagation();
            onPlay(version);
          }}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-white/22 backdrop-blur-md border border-white/40 flex items-center justify-center transition-all"
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 text-white" fill="white" />
          ) : (
            <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
          )}
        </motion.button>
      </div>

      {/* Tags below */}
      <div className="mt-4 flex items-center justify-between gap-2 px-0.5">
        <div className="flex flex-wrap gap-1.5">
          {version.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="pill">
              {tag}
            </span>
          ))}
        </div>
        <button
          onClick={() => onSelect(version)}
          className="text-[#1A1A1A] text-[12px] tracking-[0.02em] hover:text-[#FF5924] transition-colors underline-mm shrink-0"
        >
          {chooseLabel} →
        </button>
      </div>
    </div>
  );
}
