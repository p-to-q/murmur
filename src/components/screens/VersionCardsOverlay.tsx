"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause } from "lucide-react";
import { toast } from "sonner";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { useTranslator } from "@/lib/i18n";
import { synth } from "@/lib/music/simple-synth";
import type { VibeVersion } from "@/modules/shared/types";

/* ── Transition ────────────────────────────────────────────────────── */
type TransitionPhase = "idle" | "closing" | "opening" | "cards";

function playShutterClick() {
  try {
    const ctx = new AudioContext();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp((-i / ctx.sampleRate) * 120) * 0.35;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g).connect(ctx.destination);
    src.start();
    src.onended = () => ctx.close();
  } catch {
    /* silent */
  }
}

/* ── Wave clip-paths (right-high, left-low, with undulations) ─────── */
const WAVE_CLIPS = [
  // Card 0 (large left): gentle rolling wave
  `polygon(
    0% 0%, 100% 0%,
    100% 40%, 94% 43%, 88% 41%, 82% 45%, 76% 47%,
    70% 44%, 64% 48%, 58% 50%, 52% 47%, 46% 51%,
    40% 53%, 34% 50%, 28% 54%, 22% 57%, 16% 55%,
    10% 58%, 4% 56%, 0% 60%
  )`,
  // Card 1 (top right): steeper wave
  `polygon(
    0% 0%, 100% 0%,
    100% 38%, 93% 42%, 86% 40%, 79% 44%,
    72% 47%, 65% 44%, 58% 49%, 51% 51%,
    44% 48%, 37% 53%, 30% 55%, 23% 52%,
    16% 57%, 9% 55%, 0% 58%
  )`,
  // Card 2 (bottom right): shorter, more textured
  `polygon(
    0% 0%, 100% 0%,
    100% 42%, 92% 45%, 84% 43%, 76% 47%,
    68% 50%, 60% 47%, 52% 52%, 44% 54%,
    36% 51%, 28% 55%, 20% 58%, 12% 56%,
    4% 59%, 0% 62%
  )`,
];

/* ── Particles per card ───────────────────────────────────────────── */
const PARTICLES: { size: number; bottom: string; left: string; dur: number; delay: number; slow?: boolean }[][] = [
  // Card 0 (large) — more particles
  [
    { size: 5, bottom: "8%",  left: "18%", dur: 4.2, delay: 0 },
    { size: 3, bottom: "16%", left: "42%", dur: 3.5, delay: 0.8 },
    { size: 4, bottom: "6%",  left: "68%", dur: 4.8, delay: 1.4 },
    { size: 6, bottom: "14%", left: "55%", dur: 3.8, delay: 0.3, slow: true },
    { size: 3, bottom: "22%", left: "82%", dur: 4.4, delay: 2.0 },
    { size: 4, bottom: "10%", left: "30%", dur: 5.0, delay: 1.0, slow: true },
  ],
  // Card 1
  [
    { size: 4, bottom: "10%", left: "22%", dur: 3.8, delay: 0.5 },
    { size: 3, bottom: "6%",  left: "58%", dur: 4.2, delay: 1.2 },
    { size: 5, bottom: "16%", left: "78%", dur: 3.5, delay: 0, slow: true },
    { size: 3, bottom: "20%", left: "45%", dur: 4.6, delay: 1.8 },
  ],
  // Card 2
  [
    { size: 3, bottom: "8%",  left: "25%", dur: 4.0, delay: 0.3 },
    { size: 5, bottom: "14%", left: "65%", dur: 3.6, delay: 1.0, slow: true },
    { size: 4, bottom: "5%",  left: "48%", dur: 4.5, delay: 1.8 },
    { size: 3, bottom: "18%", left: "85%", dur: 3.9, delay: 0.6 },
  ],
];

/* ── Main overlay ──────────────────────────────────────────────────── */
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
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const [pickingId, setPickingId] = useState<string | null>(null);
  const prevVisible = useRef(false);

  useEffect(() => {
    if (isVisible && !prevVisible.current) {
      setPhase("closing");
      const t1 = setTimeout(() => {
        playShutterClick();
        setPhase("opening");
      }, 700);
      const t2 = setTimeout(() => setPhase("cards"), 1250);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    if (!isVisible && prevVisible.current) {
      setPhase("idle");
      setPickingId(null);
    }
    prevVisible.current = isVisible;
  }, [isVisible]);

  const handleSelect = useCallback(
    (version: VibeVersion) => {
      setPickingId(version.id);
      synth.stop();
      setCurrentVersion(version);
      // Brief animation before navigating
      setTimeout(() => router.push("/studio"), 400);
    },
    [setCurrentVersion, router],
  );

  const handleDismiss = useCallback(() => {
    synth.stop();
    setAuditioning(null);
    resetFlow();
    setRecordingState("idle");
  }, [setAuditioning, resetFlow, setRecordingState]);

  const handlePlay = useCallback(
    (version: VibeVersion) => {
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
    },
    [auditioningVersionId, setAuditioning, t],
  );

  if (!isVisible && phase === "idle") return null;
  const showCards = phase === "cards";

  return (
    <div className="fixed inset-0 z-50">
      {/* ── Phase 1: Iris-close ──────────────────────────────────── */}
      <AnimatePresence>
        {phase === "closing" && (
          <div className="absolute inset-0 z-[52]">
            <div className="absolute inset-0 iris-close bg-[#1A1A1A]" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="rainbow-ring-pulse rounded-full"
                style={{
                  width: "min(80vw, 500px)",
                  height: "min(80vw, 500px)",
                  background: "transparent",
                  border: "3px solid transparent",
                  backgroundImage:
                    "conic-gradient(from 0deg, #FF5924, #FFE040, #40E080, #40A0FF, #C070FF, #FF69D2, #FF5924)",
                  WebkitMask:
                    "linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)",
                  WebkitMaskComposite: "xor",
                  maskComposite: "exclude",
                  filter: "blur(6px)",
                }}
              />
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Phase 2: Iris-open with aurora ────────────────────────── */}
      {(phase === "opening" || phase === "cards") && (
        <div className={`absolute inset-0 z-[51] bg-[#EEEDF2] ${phase === "opening" ? "iris-open" : ""}`}>
          <div className="absolute inset-0 overflow-hidden" aria-hidden>
            <div
              className="aurora-blob-2 absolute rounded-full"
              style={{
                width: "min(60vw, 550px)", height: "min(50vw, 480px)",
                right: "-10%", top: "5%",
                background: "radial-gradient(ellipse at center, rgba(200,182,228,0.28) 0%, rgba(200,180,240,0.06) 55%, transparent 75%)",
                filter: "blur(55px)",
              }}
            />
            <div
              className="aurora-blob-3 absolute rounded-full"
              style={{
                width: "min(50vw, 450px)", height: "min(45vw, 400px)",
                left: "-5%", bottom: "8%",
                background: "radial-gradient(ellipse at center, rgba(255,200,140,0.20) 0%, rgba(255,180,100,0.05) 55%, transparent 75%)",
                filter: "blur(50px)",
              }}
            />
            <div
              className="aurora-blob-1 absolute rounded-full"
              style={{
                width: "min(35vw, 320px)", height: "min(30vw, 280px)",
                left: "40%", top: "-3%",
                background: "radial-gradient(ellipse at center, rgba(167,184,200,0.18) 0%, transparent 65%)",
                filter: "blur(45px)",
              }}
            />
          </div>
        </div>
      )}

      {/* ── Phase 3: Content ─────────────────────────────────────── */}
      <AnimatePresence>
        {showCards && (
          <motion.div
            className="absolute inset-0 z-[53] overflow-y-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: 30 }}
            transition={{ duration: 0.35 }}
          >
            <div
              className="min-h-svh flex flex-col px-5 md:px-10 md:pl-[272px] lg:px-16 lg:pl-[288px]"
              style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 48px)" }}
            >
              {/* ── Headline ─────────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="mb-6 md:mb-10"
              >
                <h2 className="hero-serif text-[#1A1A1A] text-[32px] md:text-[48px] leading-[1.05]">
                  {t("cards.headline")}
                </h2>
                <p className="text-[#8C8780] text-[13px] mt-2">
                  {t("cards.sub.short")}
                </p>
              </motion.div>

              {/* ── Bento grid ────────────────────────────────────── */}
              {/* Mobile: stacked tall rectangles
                   Desktop: 2-col bento — card 0 spans full left,
                   cards 1+2 stack on the right */}
              <div className="grid grid-cols-1 md:grid-cols-[1.15fr_1fr] md:auto-rows-[1fr] gap-4 md:gap-5 flex-1 min-h-0 md:min-h-[520px] lg:min-h-[580px]">
                {vibeVersions.map((version, i) => (
                  <motion.div
                    key={version.id}
                    initial={{ opacity: 0, y: 20, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{
                      delay: 0.06 + i * 0.1,
                      duration: 0.55,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className={i === 0 ? "md:row-span-2" : ""}
                  >
                    <VibeCard
                      version={version}
                      index={i}
                      isPlaying={auditioningVersionId === version.id}
                      isPicking={pickingId === version.id}
                      onPlay={handlePlay}
                      onSelect={handleSelect}
                      pickLabel={t("cards.choose")}
                    />
                  </motion.div>
                ))}
              </div>

              {/* ── Footer ───────────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-8 md:mt-10 pb-6"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)" }}
              >
                {/* How it works — inline italic, no collapsible */}
                <p className="font-serif-italic text-[#B6B0A4] text-[12px] md:text-[13px] leading-[1.8] max-w-xl">
                  {t("cards.how.body")}
                </p>

                <button
                  onClick={handleDismiss}
                  className="mt-5 text-[#8C8780] text-[12px] tracking-[0.04em] hover:text-[#1A1A1A] transition-colors underline-mm"
                >
                  {t("cards.redo")}
                </button>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Vibe card with wave gradient + particles ──────────────────────── */
function VibeCard({
  version,
  index,
  isPlaying,
  isPicking,
  onPlay,
  onSelect,
  pickLabel,
}: {
  version: VibeVersion;
  index: number;
  isPlaying: boolean;
  isPicking: boolean;
  onPlay: (v: VibeVersion) => void;
  onSelect: (v: VibeVersion) => void;
  pickLabel: string;
}) {
  const isLarge = index === 0;
  const particles = PARTICLES[index] ?? PARTICLES[0];
  const waveClip = WAVE_CLIPS[index] ?? WAVE_CLIPS[0];

  // Differentiated hover per card
  const hoverVariant = isLarge
    ? { scale: 1.012, transition: { duration: 0.4 } }
    : index === 1
      ? { y: -4, transition: { duration: 0.35 } }
      : { y: -3, x: -2, transition: { duration: 0.35 } };

  return (
    <motion.div
      className={[
        "relative overflow-hidden rounded-2xl cursor-pointer select-none",
        "h-[200px] md:h-full",
        isLarge ? "min-h-[200px] md:min-h-0" : "min-h-[180px] md:min-h-0",
      ].join(" ")}
      style={{ background: version.visualConfig.gradient }}
      onClick={() => onSelect(version)}
      animate={
        isPicking
          ? { scale: 0.95, opacity: 0.6, filter: "brightness(1.2)" }
          : { scale: 1, opacity: 1, filter: "brightness(1)" }
      }
      whileHover={isPicking ? undefined : hoverVariant}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
    >
      {/* ── Frosted white wave overlay (top portion) ─────────────── */}
      <div
        className="absolute inset-0 bg-white/88 backdrop-blur-[2px] z-[1]"
        style={{ clipPath: waveClip }}
      />

      {/* ── Text content (on frosted area) ───────────────────────── */}
      <div className="relative z-[3] p-5 md:p-6">
        <h3 className="font-serif text-[#1A1A1A] text-[22px] md:text-[28px] leading-tight">
          {version.vibe}
        </h3>
        <p className="text-[#8C8780] text-[11px] md:text-[12px] mt-1.5">
          {version.tags.slice(0, 2).join(" · ")}
        </p>
      </div>

      {/* ── Floating particles (in gradient area) ────────────────── */}
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white/50 pointer-events-none z-[2]"
          style={{
            width: p.size,
            height: p.size,
            bottom: p.bottom,
            left: p.left,
            animation: `${p.slow ? "particle-float-slow" : "particle-float"} ${p.dur}s ease-in-out infinite ${p.delay}s`,
          }}
        />
      ))}

      {/* ── Bottom-right actions (play + pick) ───────────────────── */}
      <div className="absolute bottom-4 right-4 md:bottom-5 md:right-5 z-[4] flex items-center gap-3">
        {/* Play / pause */}
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={(e) => {
            e.stopPropagation();
            onPlay(version);
          }}
          aria-label={isPlaying ? "Pause" : "Play"}
          className={[
            "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
            isPlaying
              ? "bg-white text-[#FF5924] shadow-[0_2px_12px_rgba(255,89,36,0.25)]"
              : "bg-white/25 backdrop-blur-sm text-white border border-white/30 hover:bg-white/40",
          ].join(" ")}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" fill="currentColor" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
          )}
        </motion.button>

        {/* Pick */}
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(version);
          }}
          className="px-4 py-2 rounded-full bg-white/90 backdrop-blur-sm text-[#1A1A1A] text-[12px] font-medium tracking-[0.02em] hover:bg-white transition-colors shadow-[0_1px_6px_rgba(0,0,0,0.08)]"
        >
          {pickLabel} →
        </motion.button>
      </div>

      {/* ── Playing state — animated border glow ─────────────────── */}
      <AnimatePresence>
        {isPlaying && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[5] rounded-2xl pointer-events-none"
            style={{
              boxShadow: "inset 0 0 0 2px rgba(255,89,36,0.35), 0 0 24px rgba(255,89,36,0.12)",
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Pick transition — expanding white circle ──────────────── */}
      <AnimatePresence>
        {isPicking && (
          <motion.div
            initial={{ scale: 0, opacity: 0.8 }}
            animate={{ scale: 3, opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="absolute bottom-4 right-4 w-20 h-20 rounded-full bg-white z-[6] pointer-events-none"
            style={{ transformOrigin: "center" }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
