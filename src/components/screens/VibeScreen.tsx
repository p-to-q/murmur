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

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { memory } from "@/lib/platform/memory";

import Image from "next/image";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { useTranslator, useI18nStore } from "@/lib/i18n";
import { versionPreview } from "@/lib/music/version-preview";
import {
  createMagentaVersions,
  regenerateVersionAudio,
  shouldUseMagentaEngine,
} from "@/modules/magenta/generate-magenta-versions";
import { buildDemoFlowStateAsync } from "@/modules/demo/demo-flow";
import type { VibeVersion } from "@/modules/shared/types";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurWave } from "@/components/murmur/murmur-wave";
import { buildMeshGradient } from "@/components/song-detail/mesh-gradient";
import {
  coverArtworkImageStyle,
  coverBrightnessCompensationStyle,
} from "@/lib/music/cover-visual-treatment";
import { VIBE_PRESETS } from "@/presets/vibes";

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

export function VibeScreen({ initialDemo = false }: { initialDemo?: boolean }) {
  const auditionStartTimerRef = useRef<number | null>(null);
  const router = useRouter();
  const t = useTranslator();
  const {
    vibeVersions,
    setVibeVersions,
    setCurrentVersion,
    setCurrentDraftId,
    setCurrentFlowId,
    currentDraftId,
    currentFlowId,
    auditioningVersionId,
    setAuditioning,
    resetFlow,
    humStyleBlob,
  } = useMurmurStore();

  const [phase, setPhase] = useState<Phase>("closing");
  const [pickingId, setPickingId] = useState<string | null>(null);
  const demoSeededRef = useRef(false);
  const sourceVersion = vibeVersions[0] ?? null;
  const fromSavedSong = sourceVersion?.sourceType === "library";
  const demoEnabled = initialDemo;

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
    if (!demoEnabled || vibeVersions.length > 0 || demoSeededRef.current) {
      return;
    }
    demoSeededRef.current = true;
    void buildDemoFlowStateAsync().then((demo) => {
      setVibeVersions(demo.versions);
      setCurrentDraftId(demo.draftId);
      setCurrentFlowId(demo.flowId);
    });
  }, [
    demoEnabled,
    setCurrentDraftId,
    setCurrentFlowId,
    setVibeVersions,
    vibeVersions.length,
  ]);

  useEffect(() => {
    if (phase === "cards" && vibeVersions.length === 0 && !demoEnabled) {
      router.replace("/");
    }
  }, [demoEnabled, phase, vibeVersions.length, router]);

  /* ── Stop preview on unmount ──────────────────────────────────── */
  useEffect(() => {
    return () => {
      if (auditionStartTimerRef.current !== null) {
        window.clearTimeout(auditionStartTimerRef.current);
      }
      versionPreview.stop();
      setAuditioning(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = useCallback(
    (version: VibeVersion) => {
      if (pickingId) return;
      setPickingId(version.id);
      versionPreview.stop();
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
      if (auditionStartTimerRef.current !== null) {
        window.clearTimeout(auditionStartTimerRef.current);
        auditionStartTimerRef.current = null;
      }

      if (auditioningVersionId === version.id) {
        versionPreview.stop();
        setAuditioning(null);
        return;
      }

      // Magenta clips stream in asynchronously — no audio yet, no sound.
      if (version.generation && version.generation.status !== "ready") {
        if (version.generation.status === "error") {
          regenerateVersionAudio(version);
          toast(t("vibe.gen.retrying") || "Brewing this one again…");
        } else {
          toast(t("vibe.generating.toast") || "Still brewing — a few more seconds.");
        }
        return;
      }

      try {
        versionPreview.stop();
        setAuditioning(version.id); // Immediately set as auditioning
        if (!versionPreview.play(version)) {
          setAuditioning(null);
        }
      } catch (err) {
        console.error("[Vibe] audition error:", err);
        toast.error(t("cards.play_error") || "Couldn't play that preview.");
        setAuditioning(null);
      }
    },
    [auditioningVersionId, setAuditioning, t],
  );

  const handleReroll = useCallback(async () => {
    if (vibeVersions.length === 0) return;
    const first = vibeVersions[0]!;
    versionPreview.stop();
    setAuditioning(null);
    const common = {
      draftId: currentDraftId ?? first.draftId,
      originFlowId: currentFlowId ?? first.originFlowId,
      sourceType: first.sourceType,
      sourceMelodyKind: first.sourceMelodyKind,
    };
    // Magenta is the only engine. A batch already on Magenta rerolls straight
    // to the next batch; a legacy batch (only reachable via demo/remix seeds)
    // re-probes once. If the worker is down we keep the current batch and tell
    // the user to retry, rather than silently generating structured audio.
    const useMagenta =
      first.generation !== undefined || (await shouldUseMagentaEngine());
    if (!useMagenta) {
      toast(t("vibe.gen.engine_warming") || "Music engine is warming up — try again in a moment.");
      return;
    }
    const fresh = createMagentaVersions(first.melody, {
      ...common,
      batchIndex: (first.generation?.batchIndex ?? -1) + 1,
      humBlob: humStyleBlob,
    });
    setVibeVersions(fresh);
  }, [
    currentDraftId,
    currentFlowId,
    humStyleBlob,
    setAuditioning,
    setVibeVersions,
    t,
    vibeVersions,
  ]);

  const handleBack = useCallback(() => {
    versionPreview.stop();
    setAuditioning(null);
    resetFlow();
    if (fromSavedSong && sourceVersion?.draftId) {
      router.push(`/song/${sourceVersion.draftId}`);
      return;
    }
    router.push("/");
  }, [fromSavedSong, resetFlow, router, setAuditioning, sourceVersion]);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      {/* ── Phase 1: iris-close + rainbow ring ───────────────────── */}
      {phase === "closing" && (
        <div className="pointer-events-none fixed inset-0 z-[60]">
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
                  "conic-gradient(from 0deg, #FF5924, #EBCB8B, #A7B8C8, #C9B6E4, #FF8A5C, #FF5924)",
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
              style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 36px)" }}
            >
              {/* ── Compact header ─────────────────────────────
                  Mobile: utility row (back | reroll) + headline on its own
                  line — three items in one 375px row clipped the headline.
                  md+: original single baseline row with the headline
                  between the buttons. */}
              <div className="mb-4" style={{ paddingTop: "20px" }}>
                <div className="flex items-center md:items-end justify-between gap-4">
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                    onClick={handleBack}
                    className="text-[12px] tracking-[0.04em] text-[#8C8780] hover:text-[#1A1A1A] transition-colors whitespace-nowrap"
                  >
                    ← {fromSavedSong
                      ? t("vibe.back.saved") || "Back to your song"
                      : t("vibe.back") || "Try a different hum"}
                  </motion.button>
                  <motion.h2
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.4 }}
                    className="hidden md:block flex-1 text-center font-serif-italic text-[26px] text-[#8B8781]"
                  >
                    {t("cards.sub.short") || "Listen, then pick the one that feels right."}
                  </motion.h2>
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15, duration: 0.4 }}
                    onClick={handleReroll}
                    className="text-[12px] tracking-[0.04em] text-[#8C8780] hover:text-[#1A1A1A] transition-colors whitespace-nowrap"
                  >
                    {t("vibe.reroll") || "New set"} →
                  </motion.button>
                </div>
                <motion.h2
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1, duration: 0.4 }}
                  className="md:hidden mt-3 px-2 text-center font-serif-italic text-[17px] leading-snug text-[#8B8781]"
                >
                  {t("cards.sub.short") || "Listen, then pick the one that feels right."}
                </motion.h2>
              </div>

              {/* ── Card grid — dominates the viewport ───────── */}
              <div className="grid grid-cols-1 md:grid-cols-[1.18fr_1fr] gap-4 md:gap-5 flex-1 min-h-0 md:min-h-[68vh] lg:min-h-[72vh]">
                {vibeVersions.map((version, i) => {
                  const isLarge = i === 0;
                  const isAuditioning = auditioningVersionId === version.id;
                  const isPicking = pickingId === version.id;
                  const someoneIsAuditioning = auditioningVersionId !== null;
                  return (
                    <motion.div
                      key={version.id}
                      initial={{ opacity: 0, y: 22, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{
                        delay: 0.06 + i * 0.09,
                        duration: 0.6,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className={isLarge ? "md:row-span-2" : ""}
                    >
                      <VibeCard
                        version={version}
                        isLarge={isLarge}
                        isAuditioning={isAuditioning}
                        someoneIsAuditioning={someoneIsAuditioning}
                        isPicking={isPicking}
                        onPick={handlePick}
                        onPlayToggle={handleAudition}
                        pickLabel={t("cards.choose") || "Pick"}
                      />
                    </motion.div>
                  );
                })}
              </div>

              {/* ── Minimal footer ───────────────────────────── */}
              <div
                className="mt-4"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)" }}
              />
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
  someoneIsAuditioning,
  isPicking,
  onPick,
  onPlayToggle,
  pickLabel,
}: {
  version: VibeVersion;
  isLarge: boolean;
  isAuditioning: boolean;
  someoneIsAuditioning: boolean;
  isPicking: boolean;
  onPick: (v: VibeVersion) => void;
  onPlayToggle: (v: VibeVersion) => void;
  pickLabel: string;
}) {
  const lang = useI18nStore((state) => state.lang);
  const t = useTranslator();
  const accent = extractFirstHex(version.visualConfig.gradient) ?? "#FF8A5C";
  const vibePreset = VIBE_PRESETS.find((p) => p.id === version.vibe);
  const vibeLabel =
    version.generation?.vibeLabel[lang] || vibePreset?.label[lang] || version.vibe;
  const genStatus = version.generation?.status ?? "ready";
  const isPending = genStatus === "pending";
  const isError = genStatus === "error";

  const artwork = version.visualConfig.artwork;
  const artworkPath = artwork?.backgroundImagePath ?? artwork?.imagePath;
  const meshStyle = buildMeshGradient(version.visualConfig.gradient, artwork?.palette);

  // Background layer blur: idle = slight soft focus, auditioning = clear, others = blurred
  const bgBlur = isAuditioning ? 0 : someoneIsAuditioning ? 4.5 : 1.5;
  const bgBrightness = isAuditioning ? 1.05 : someoneIsAuditioning ? 0.82 : 1;

  return (
    <motion.div
      className="relative overflow-hidden rounded-[32px] cursor-pointer select-none h-full min-h-[200px] md:min-h-[240px]"
      onClick={() => onPick(version)}
      whileHover={!isPicking && !someoneIsAuditioning ? { y: -3 } : undefined}
      animate={isPicking ? { scale: 0.95 } : { scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 26 }}
    >
      {/* ── Visual background layer — this blurs, text does not ── */}
      <motion.div
        className="absolute inset-0 rounded-[32px] overflow-hidden"
        animate={{
          filter: `blur(${bgBlur}px) brightness(${bgBrightness})`,
        }}
        transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Mesh gradient fill */}
        <div className="absolute inset-0" style={meshStyle} />
        {artwork && artworkPath && (
          <Image
            src={artworkPath}
            alt={artwork.title ?? ""}
            fill
            sizes="(max-width: 768px) 100vw, 60vw"
            className="absolute inset-0 h-full w-full object-cover opacity-35"
            style={coverArtworkImageStyle(artwork)}
          />
        )}
        {artworkPath && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={coverBrightnessCompensationStyle}
          />
        )}
        {/* Top darken for legibility */}
        <div
          className="absolute inset-x-0 top-0 h-2/5 pointer-events-none"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 100%)",
          }}
        />
        {/* Bottom fade */}
        <div
          className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 100%)",
          }}
        />
        {/* Wave — bottom 55% */}
        <MurmurWave
          color={accent}
          intensity={isAuditioning ? 0.85 : 0.52}
          isPlaying={isAuditioning}
          waveY={0.48}
          className="absolute inset-x-0 bottom-0 h-[58%] w-full pointer-events-none"
        />
      </motion.div>

      {/* ── Active glow ring (not blurred) ── */}
      <AnimatePresence>
        {isAuditioning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 z-10 rounded-[32px] pointer-events-none"
            style={{
              boxShadow:
                "inset 0 0 0 2px rgba(255,255,255,0.65), 0 0 36px rgba(255,255,255,0.14)",
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Text — always sharp ── */}
      <div className="relative z-20 p-6 md:p-8">
        <h3
          className={`font-serif-italic text-white leading-[1.0] ${
            isLarge
              ? "text-[44px] md:text-[64px] lg:text-[72px]"
              : "text-[30px] md:text-[40px]"
          }`}
          style={{ letterSpacing: "-0.015em" }}
        >
          {vibeLabel}
        </h3>
        <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-white/50">
          {isPending
            ? t("vibe.generating") || "Brewing"
            : isError
              ? t("vibe.gen.failed") || "Didn't brew — tap retry"
              : version.tags.slice(0, 3).join(" · ")}
        </p>
      </div>

      {/* ── Buttons — always sharp ── */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-2.5">
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={(e) => {
            e.stopPropagation();
            onPlayToggle(version);
          }}
          aria-label={
            isPending
              ? "Generating preview"
              : isError
                ? "Retry generation"
                : isAuditioning
                  ? "Pause preview"
                  : "Play preview"
          }
          className={[
            "flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm transition-all duration-200",
            isAuditioning
              ? "border-white/55 bg-white/90 text-[#1A1A1A] shadow-[0_4px_16px_rgba(0,0,0,0.14)]"
              : "border-white/35 bg-white/16 text-white hover:bg-white/24",
          ].join(" ")}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isError ? (
            <RotateCw className="h-3.5 w-3.5" />
          ) : isAuditioning ? (
            <Pause className="h-3.5 w-3.5" fill="currentColor" />
          ) : (
            <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />
          )}
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={(e) => {
            e.stopPropagation();
            onPick(version);
          }}
          className="inline-flex h-11 items-center rounded-full bg-white/90 px-5 text-[13px] font-medium text-[#1A1A1A] shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-colors hover:bg-white"
        >
          {pickLabel} →
        </motion.button>
      </div>

      {/* Pick burst */}
      <AnimatePresence>
        {isPicking && (
          <motion.div
            initial={{ scale: 0, opacity: 0.9 }}
            animate={{ scale: 5, opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="absolute left-1/2 top-1/2 z-30 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white pointer-events-none"
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function extractFirstHex(gradient: string): string | null {
  const m = gradient.match(/#([0-9a-fA-F]{6})/);
  return m ? `#${m[1]}` : null;
}
