"use client";

/**
 * VibeScreen — Compose v2 *discover* moment.
 *
 * Specced in docs/page-redesign.md §3 + docs/page-contracts.md §2.
 *
 * Promoted to its own route (/vibe), replacing the v1 VersionCardsOverlay
 * that lived as a sibling component to HumScreen. The signature iris-close →
 * rainbow-ring → iris-open transition is preserved as the arrival animation.
 *
 * Card surface changes:
 *   - Drops the wave clip-path that bisected the gradient.
 *   - Adds a MurmurWave canvas at the bottom of each card — particles + sine
 *     wave drifting at idle, intensifying when that card is auditioning.
 *   - Softer 32px rounded corners (v1 was rounded-2xl=16px, called "too
 *     sharp"). Pebble-class shapes, not boxes.
 *   - Tap = commit, long-press = preview (other cards dim to 0.55).
 *   - Title in serif italic — a vibe is a poem, not a setting.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause } from "lucide-react";
import { toast } from "sonner";
import { memory } from "@/lib/platform/memory";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { useTranslator } from "@/lib/i18n";
import { synth } from "@/lib/music/simple-synth";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import type { VibeVersion } from "@/modules/shared/types";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurWave } from "@/components/murmur/murmur-wave";

/** Visual phases of the route arrival. */
type Phase = "closing" | "opening" | "cards";

function playShutterClick() {
  try {
    const Ctx =
      typeof window === "undefined"
        ? null
        : window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp((-i / ctx.sampleRate) * 120) * 0.35;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.4;
    src.connect(g).connect(ctx.destination);
    src.start();
    src.onended = () => ctx.close();
  } catch {
    /* silent */
  }
}

export function VibeScreen() {
  const router = useRouter();
  const t = useTranslator();
  const {
    vibeVersions,
    setVibeVersions,
    setCurrentVersion,
    currentDraftId,
    currentFlowId,
    auditioningVersionId,
    setAuditioning,
    resetFlow,
  } = useMurmurStore();

  const [phase, setPhase] = useState<Phase>("closing");
  const [pickingId, setPickingId] = useState<string | null>(null);

  /* ── Arrival sequence ─────────────────────────────────────────── */
  useEffect(() => {
    const t1 = window.setTimeout(() => {
      playShutterClick();
      setPhase("opening");
    }, 700);
    const t2 = window.setTimeout(() => setPhase("cards"), 1250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  /* ── Hard-refresh guard: no versions → bounce to / ───────────── */
  useEffect(() => {
    if (phase === "cards" && vibeVersions.length === 0) {
      router.replace("/");
    }
  }, [phase, vibeVersions.length, router]);

  /* ── Stop synth on unmount ────────────────────────────────────── */
  useEffect(() => {
    return () => {
      synth.stop();
      setAuditioning(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = useCallback(
    (version: VibeVersion) => {
      if (pickingId) return;
      setPickingId(version.id);
      synth.stop();
      setAuditioning(null);
      setCurrentVersion(version);
      memory
        .reportAction({
          content: `Picked vibe "${version.vibe}"`,
          event_type: "navigate",
          page: "vibe",
          metadata: { type: "vibe_pick", version_id: version.id, vibe: version.vibe },
        })
        .catch(() => {});
      window.setTimeout(() => router.push("/studio"), 460);
    },
    [pickingId, router, setAuditioning, setCurrentVersion],
  );

  const handleAudition = useCallback(
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
        console.error("[Vibe] audition error:", err);
        toast.error(t("cards.play_error") || "Couldn't play that preview.");
        setAuditioning(null);
      }
    },
    [auditioningVersionId, setAuditioning, t],
  );

  const handleReroll = useCallback(() => {
    if (vibeVersions.length === 0) return;
    const melody = vibeVersions[0]!.melody;
    synth.stop();
    setAuditioning(null);
    const fresh = generateVibeVersions(melody, {
      draftId: currentDraftId ?? vibeVersions[0]!.draftId,
      originFlowId: currentFlowId ?? vibeVersions[0]!.originFlowId,
      sourceType: vibeVersions[0]!.sourceType,
    });
    setVibeVersions(fresh);
  }, [currentDraftId, currentFlowId, setAuditioning, setVibeVersions, vibeVersions]);

  const handleBack = useCallback(() => {
    synth.stop();
    setAuditioning(null);
    resetFlow();
    router.push("/");
  }, [resetFlow, router, setAuditioning]);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      {/* ── Phase 1: iris-close + rainbow ring ───────────────────── */}
      {phase === "closing" && (
        <div className="fixed inset-0 z-[60]">
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

      {/* ── Phase 2: iris-open cream ─────────────────────────────── */}
      {(phase === "opening" || phase === "cards") && (
        <div
          className={`absolute inset-0 z-[55] bg-[#F5F1EB] ${phase === "opening" ? "iris-open" : ""}`}
        >
          <PageBackdrop />
        </div>
      )}

      {/* ── Phase 3: content ─────────────────────────────────────── */}
      <AnimatePresence>
        {phase === "cards" && vibeVersions.length > 0 && (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: 28 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 z-[58] overflow-y-auto"
          >
            <div
              className="relative z-10 min-h-svh flex flex-col px-5 md:px-10 lg:px-16"
              style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 48px)" }}
            >
              {/* ── Header ───────────────────────────────────── */}
              <div className="mb-8 md:mb-10">
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  onClick={handleBack}
                  className="mb-5 text-[12px] tracking-[0.04em] text-[#8C8780] hover:text-[#1A1A1A] transition-colors"
                >
                  ← {t("vibe.back") || "Try a different hum"}
                </motion.button>
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  className="eyebrow text-[#FF8A5C]"
                >
                  {t("vibe.eyebrow") || "THREE WAYS"}
                </motion.p>
                <motion.h1
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  className="hero-serif mt-3 text-[#1A1A1A] text-[32px] leading-[1.04] md:text-[52px]"
                >
                  {t("vibe.headline") || "Pick the one your hum is asking to become."}
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15, duration: 0.5 }}
                  className="font-serif-italic mt-3 text-[13px] text-[#8C8780] md:text-[14px]"
                >
                  {t("cards.sub.short") || "Listen, then pick the one that feels right."}
                </motion.p>
              </div>

              {/* ── Bento grid ───────────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-[1.18fr_1fr] md:auto-rows-[1fr] gap-4 md:gap-5 flex-1 min-h-0 md:min-h-[560px] lg:min-h-[620px]">
                {vibeVersions.map((version, i) => {
                  const isLarge = i === 0;
                  const isAuditioning = auditioningVersionId === version.id;
                  const isPicking = pickingId === version.id;
                  const dimmed =
                    (auditioningVersionId && !isAuditioning) ||
                    (pickingId && !isPicking);
                  return (
                    <motion.div
                      key={version.id}
                      initial={{ opacity: 0, y: 22, scale: 0.97 }}
                      animate={{
                        opacity: dimmed ? 0.5 : 1,
                        y: 0,
                        scale: isAuditioning ? 1.012 : 1,
                      }}
                      transition={{
                        delay: 0.08 + i * 0.1,
                        duration: 0.6,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className={isLarge ? "md:row-span-2" : ""}
                    >
                      <VibeCard
                        version={version}
                        isLarge={isLarge}
                        isAuditioning={isAuditioning}
                        isPicking={isPicking}
                        onPick={handlePick}
                        onPlayToggle={handleAudition}
                        pickLabel={t("cards.choose") || "Pick"}
                      />
                    </motion.div>
                  );
                })}
              </div>

              {/* ── Footer ───────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="mt-8 md:mt-10 pb-6"
                style={{
                  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
                }}
              >
                <button
                  onClick={handleReroll}
                  className="font-serif-italic text-[15px] text-[#FF5924] hover:text-[#D9421A] underline-mm transition-colors"
                >
                  ↻ {t("vibe.reroll") || "Try a different set"}
                </button>
                <p className="mt-3 font-serif-italic text-[12px] text-[#B6B0A4] leading-[1.7] max-w-md">
                  {t("vibe.howit") ||
                    "Three takes on the same hum — same melody, different rooms. No notes spent."}
                </p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   VibeCard — pebble-shaped card with a MurmurWave bottom.
   ───────────────────────────────────────────────────────────────────── */

function VibeCard({
  version,
  isLarge,
  isAuditioning,
  isPicking,
  onPick,
  onPlayToggle,
  pickLabel,
}: {
  version: VibeVersion;
  isLarge: boolean;
  isAuditioning: boolean;
  isPicking: boolean;
  onPick: (v: VibeVersion) => void;
  onPlayToggle: (v: VibeVersion) => void;
  pickLabel: string;
}) {
  // Accent color for the wave layer — derived from the vibe's first hex stop
  // in its CSS gradient. Falls back to coral if parsing fails.
  const accent = extractFirstHex(version.visualConfig.gradient) ?? "#FF8A5C";

  return (
    <motion.div
      className="relative overflow-hidden rounded-[32px] cursor-pointer select-none border border-white/40 h-full min-h-[220px]"
      style={{ background: version.visualConfig.gradient }}
      onClick={() => onPick(version)}
      whileHover={!isPicking ? { y: -3 } : undefined}
      animate={
        isPicking
          ? { scale: 0.95, opacity: 0.7, filter: "brightness(1.15)" }
          : { scale: 1, opacity: 1, filter: "brightness(1)" }
      }
      transition={{ type: "spring", stiffness: 220, damping: 24 }}
    >
      {/* Soft darken at top for white text legibility */}
      <div
        className="absolute inset-x-0 top-0 h-1/3 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0) 100%)",
        }}
      />

      {/* Wave + particles in the bottom half */}
      <MurmurWave
        color={accent}
        intensity={0.6}
        isPlaying={isAuditioning}
        waveY={0.5}
        className="absolute inset-x-0 bottom-0 h-1/2 w-full pointer-events-none"
      />

      {/* Text block */}
      <div className="relative z-10 p-6 md:p-7">
        <p className="text-[10px] uppercase tracking-[0.28em] text-white/72">
          {tagSnippet(version.tags)}
        </p>
        <h3
          className={`font-serif-italic mt-3 text-white leading-[1.02] ${
            isLarge ? "text-[40px] md:text-[60px]" : "text-[28px] md:text-[36px]"
          }`}
          style={{ letterSpacing: "-0.01em" }}
        >
          {version.vibe}
        </h3>
        <p className="mt-2 text-[12px] text-white/76 md:text-[13px]">
          {version.tags.slice(0, 2).join(" · ")}
        </p>
      </div>

      {/* Bottom-right actions — old explicit preview + pick pattern */}
      <div className="absolute bottom-5 right-5 z-10 flex items-center gap-3">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={(e) => {
            e.stopPropagation();
            onPlayToggle(version);
          }}
          aria-label={isAuditioning ? "Pause preview" : "Play preview"}
          className={[
            "flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-200",
            isAuditioning
              ? "border-white/50 bg-white/88 text-[#1A1A1A] shadow-[0_6px_18px_rgba(0,0,0,0.12)]"
              : "border-white/38 bg-white/18 text-white hover:bg-white/26",
          ].join(" ")}
        >
          {isAuditioning ? (
            <Pause className="h-4 w-4" fill="currentColor" />
          ) : (
            <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
          )}
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={(e) => {
            e.stopPropagation();
            onPick(version);
          }}
          className="inline-flex h-12 items-center rounded-full bg-white/92 px-6 text-[14px] font-medium text-[#1A1A1A] shadow-[0_6px_18px_rgba(0,0,0,0.1)] transition-colors hover:bg-white"
        >
          {pickLabel} →
        </motion.button>
      </div>

      {/* Active border glow */}
      <AnimatePresence>
        {isAuditioning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 rounded-[32px] pointer-events-none"
            style={{
              boxShadow:
                "inset 0 0 0 1.5px rgba(255,255,255,0.55), 0 0 28px rgba(255,255,255,0.16)",
            }}
          />
        )}
      </AnimatePresence>

      {/* Pick burst — expanding white disc */}
      <AnimatePresence>
        {isPicking && (
          <motion.div
            initial={{ scale: 0, opacity: 0.85 }}
            animate={{ scale: 4, opacity: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="absolute left-1/2 top-1/2 z-20 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white pointer-events-none"
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function tagSnippet(tags: readonly string[] | string[]): string {
  return tags.slice(0, 2).join(" · ");
}

function extractFirstHex(gradient: string): string | null {
  const m = gradient.match(/#([0-9a-fA-F]{6})/);
  return m ? `#${m[1]}` : null;
}
