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

import { useMurmurStore } from "@/lib/store/murmur-store";
import { trackStageEntered } from "@/lib/observability/stage-tracking";
import { useCurrentLang, useTranslator } from "@/lib/i18n";
import { versionPreview } from "@/lib/music/version-preview";
import {
  createMagentaVersions,
  regenerateVersionAudio,
  shouldUseMagentaEngine,
} from "@/modules/magenta/generate-magenta-versions";
import { buildDemoFlowStateAsync } from "@/modules/demo/demo-flow";
import {
  getVersionReadinessBlockReason,
} from "@/modules/music/version-contract";
import type { VibeVersion } from "@/modules/shared/types";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurWave } from "@/components/murmur/murmur-wave";
import { hashString } from "@/lib/music/seeded-random";
import { VIBE_PRESETS } from "@/presets/vibes";

/** Visual phases of the route arrival. */
type Phase = "closing" | "opening" | "cards";

const STAR_SEA_VISUALS = [
  {
    gradient: "linear-gradient(148deg, #16242C 0%, #3F7791 48%, #D7D0BF 100%)",
    accent: "#D7D0BF",
  },
  {
    gradient: "linear-gradient(148deg, #102A43 0%, #2F80A0 45%, #E6C98A 100%)",
    accent: "#E6C98A",
  },
  {
    gradient: "linear-gradient(148deg, #18313F 0%, #4A9B8E 48%, #D8E6D6 100%)",
    accent: "#D8E6D6",
  },
  {
    gradient: "linear-gradient(148deg, #466E82 0%, #8FB0BA 48%, #E7E4D8 100%)",
    accent: "#E7E4D8",
  },
  {
    gradient: "linear-gradient(148deg, #0F3A3D 0%, #4F9F9A 46%, #F0CC8B 100%)",
    accent: "#F0CC8B",
  },
  {
    gradient: "linear-gradient(148deg, #24223D 0%, #586CA3 48%, #C8BEDD 100%)",
    accent: "#C8BEDD",
  },
  {
    gradient: "linear-gradient(148deg, #6C3D6F 0%, #D46A76 45%, #F6C36E 100%)",
    accent: "#F6C36E",
  },
  {
    gradient: "linear-gradient(148deg, #FFBA5A 0%, #F0663E 42%, #B87FCC 100%)",
    accent: "#FFBA5A",
  },
  {
    gradient: "linear-gradient(148deg, #123C35 0%, #5E937F 48%, #E3C77A 100%)",
    accent: "#E3C77A",
  },
  {
    gradient: "linear-gradient(148deg, #202D54 0%, #2D9AB1 45%, #B5E3C8 100%)",
    accent: "#B5E3C8",
  },
  {
    gradient: "linear-gradient(148deg, #161616 0%, #5C6063 48%, #EFEDE5 100%)",
    accent: "#EFEDE5",
  },
  {
    gradient: "linear-gradient(148deg, #1B2541 0%, #6F85B8 48%, #D6D6C5 100%)",
    accent: "#D6D6C5",
  },
] as const;

function resolveStarSeaVisual(visualBatchSeed: number, version: VibeVersion, cardIndex: number) {
  const batchIndex = version.generation?.batchIndex ?? 0;
  const index =
    (visualBatchSeed + batchIndex * 3 + cardIndex * 5) % STAR_SEA_VISUALS.length;
  return STAR_SEA_VISUALS[index]!;
}

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
    setActiveCreationRoute,
    currentDraftId,
    currentFlowId,
    auditioningVersionId,
    setAuditioning,
    resetFlow,
    humStyleBlob,
    restoredDraftAt,
  } = useMurmurStore();

  const [phase, setPhase] = useState<Phase>("closing");
  const [pickingId, setPickingId] = useState<string | null>(null);
  const demoSeededRef = useRef(false);
  const sourceVersion = vibeVersions[0] ?? null;
  const fromSavedSong = sourceVersion?.sourceType === "library";
  const demoEnabled = initialDemo;
  const restoredRegenerationRef = useRef<number | null>(null);

  useEffect(() => {
    if (vibeVersions.length > 0) {
      setActiveCreationRoute("/vibe");
    }
  }, [setActiveCreationRoute, vibeVersions.length]);

  useEffect(() => {
    trackStageEntered("vibe", { flowId: currentFlowId ?? undefined, draftId: currentDraftId ?? undefined });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (vibeVersions.length === 0 && !demoEnabled) {
      router.replace("/");
    }
  }, [demoEnabled, vibeVersions.length, router]);

  useEffect(() => {
    if (!restoredDraftAt || restoredRegenerationRef.current === restoredDraftAt) {
      return;
    }
    const needsRegeneration = vibeVersions.filter(
      (version) =>
        version.generation &&
        version.generation.status === "pending" &&
        !version.generation.audioUrl,
    );
    if (needsRegeneration.length === 0) return;
    restoredRegenerationRef.current = restoredDraftAt;
    for (const version of needsRegeneration) {
      regenerateVersionAudio(version);
    }
  }, [restoredDraftAt, vibeVersions]);

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

  const handleGenerationRecovery = useCallback(
    (version: VibeVersion) => {
      const code = version.generation?.errorCode;
      if (code === "insufficient_notes") {
        toast(t("vibe.gen.insufficient_toast") || "Top up notes before brewing more.");
        router.push("/topup");
        return;
      }
      if (code === "rate_limited") {
        toast(t("vibe.gen.rate_limited_toast") || "Too many generations in a row. Try again shortly.");
        return;
      }
    },
    [router, t],
  );

  const handleRetryVersion = useCallback(
    (version: VibeVersion) => {
      if (version.generation?.status !== "error") return;
      if (!canRetryGeneration(version)) {
        handleGenerationRecovery(version);
        return;
      }
      if (auditionStartTimerRef.current !== null) {
        window.clearTimeout(auditionStartTimerRef.current);
        auditionStartTimerRef.current = null;
      }
      versionPreview.stop();
      setAuditioning(null);
      regenerateVersionAudio(version);
      toast(t("vibe.gen.retrying") || "Brewing this one again…");
    },
    [handleGenerationRecovery, setAuditioning, t],
  );

  const handlePick = useCallback(
    (version: VibeVersion) => {
      if (pickingId) return;
      const blockReason = getVersionReadinessBlockReason(version);
      if (blockReason === "generation_failed") {
        handleRetryVersion(version);
        return;
      }
      if (blockReason === "generation_pending") {
        toast(t("vibe.pick.pending") || "Let this one finish before Studio.");
        return;
      }

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
    [handleRetryVersion, pickingId, router, setAuditioning, setCurrentVersion, t],
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

      const blockReason = getVersionReadinessBlockReason(version);
      if (blockReason === "generation_failed") {
        handleRetryVersion(version);
        return;
      }
      if (blockReason === "generation_pending") {
        toast(t("vibe.generating.toast") || "Still brewing — a few more seconds.");
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
    [auditioningVersionId, handleRetryVersion, setAuditioning, t],
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
    const sourceSongId = sourceVersion?.parentSongId ?? sourceVersion?.draftId;
    if (fromSavedSong && sourceSongId) {
      router.push(`/song/${sourceSongId}`);
      return;
    }
    router.push("/");
  }, [fromSavedSong, resetFlow, router, setAuditioning, sourceVersion]);

  const visualBatchSeed = hashString(
    vibeVersions.map((candidate) => candidate.id).join(":"),
  );

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
                        visualBatchSeed={visualBatchSeed}
                        cardIndex={i}
                        isLarge={isLarge}
                        isAuditioning={isAuditioning}
                        someoneIsAuditioning={someoneIsAuditioning}
                        isPicking={isPicking}
                        onPick={handlePick}
                        onRetry={handleRetryVersion}
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
  visualBatchSeed,
  cardIndex,
  isLarge,
  isAuditioning,
  someoneIsAuditioning,
  isPicking,
  onPick,
  onRetry,
  onPlayToggle,
  pickLabel,
}: {
  version: VibeVersion;
  visualBatchSeed: number;
  cardIndex: number;
  isLarge: boolean;
  isAuditioning: boolean;
  someoneIsAuditioning: boolean;
  isPicking: boolean;
  onPick: (v: VibeVersion) => void;
  onRetry: (v: VibeVersion) => void;
  onPlayToggle: (v: VibeVersion) => void;
  pickLabel: string;
}) {
  const lang = useCurrentLang();
  const t = useTranslator();
  const vibePreset = VIBE_PRESETS.find((p) => p.id === version.vibe);
  const vibeLabel =
    version.generation?.vibeLabel[lang] || vibePreset?.label[lang] || version.vibe;
  const readinessBlockReason = getVersionReadinessBlockReason(version);
  const isPending = readinessBlockReason === "generation_pending";
  const isError = readinessBlockReason === "generation_failed";
  const canEnterStudio = readinessBlockReason === null;
  const errorRecovery = generationErrorRecovery(version);
  const pickButtonLabel = isError
    ? t(errorRecovery.ctaKey) || errorRecovery.ctaFallback
    : isPending
      ? t("vibe.pick.wait") || "Brewing"
      : pickLabel;
  const starSeaVisual = resolveStarSeaVisual(visualBatchSeed, version, cardIndex);

  // Background layer blur: idle = slight soft focus, auditioning = clear, others = blurred
  const bgBlur = isAuditioning ? 0 : someoneIsAuditioning ? 4.5 : 1.5;
  const bgBrightness = isAuditioning ? 1.05 : someoneIsAuditioning ? 0.82 : 1;

  return (
    <motion.div
      aria-disabled={!canEnterStudio}
      className={[
        "relative h-full min-h-[200px] select-none overflow-hidden rounded-[32px] md:min-h-[240px]",
        isPending ? "cursor-wait" : "cursor-pointer",
      ].join(" ")}
      onClick={() => onPick(version)}
      whileHover={
        !isPicking && !someoneIsAuditioning && !isPending ? { y: -3 } : undefined
      }
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
        <div className="absolute inset-0" style={{ background: starSeaVisual.gradient }} />
        <MurmurWave
          color={starSeaVisual.accent}
          intensity={isAuditioning ? 0.88 : 0.56}
          isPlaying={isAuditioning}
          waveY={isLarge ? 0.5 : 0.46}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[64%] w-full"
        />
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
              ? t(errorRecovery.detailKey) || errorRecovery.detailFallback
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
                ? errorRecovery.ctaFallback
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
          disabled={isPending}
          onClick={(e) => {
            e.stopPropagation();
            if (isError) {
              onRetry(version);
              return;
            }
            onPick(version);
          }}
          className={[
            "inline-flex h-11 items-center rounded-full px-5 text-[13px] font-medium shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-colors",
            isPending
              ? "cursor-not-allowed bg-white/55 text-[#5F5850]/70"
              : "bg-white/90 text-[#1A1A1A] hover:bg-white",
          ].join(" ")}
        >
          {pickButtonLabel} {!isPending ? "→" : ""}
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

function canRetryGeneration(version: VibeVersion): boolean {
  const code = version.generation?.errorCode;
  return code !== "insufficient_notes" && code !== "rate_limited";
}

function generationErrorRecovery(version: VibeVersion): {
  ctaKey: string;
  ctaFallback: string;
  detailKey: string;
  detailFallback: string;
} {
  switch (version.generation?.errorCode) {
    case "insufficient_notes":
      return {
        ctaKey: "vibe.gen.topup",
        ctaFallback: "Top up",
        detailKey: "vibe.gen.insufficient_notes",
        detailFallback: "Out of notes — top up to brew more.",
      };
    case "rate_limited":
      return {
        ctaKey: "vibe.gen.wait",
        ctaFallback: "Try later",
        detailKey: "vibe.gen.rate_limited",
        detailFallback: "Too many generations in a row — try again shortly.",
      };
    case "billing_unavailable":
      return {
        ctaKey: "vibe.retry",
        ctaFallback: "Retry",
        detailKey: "vibe.gen.billing_unavailable",
        detailFallback: "Notes ledger unavailable — try again in a bit.",
      };
    case "worker_unconfigured":
      return {
        ctaKey: "vibe.retry",
        ctaFallback: "Retry",
        detailKey: "vibe.gen.worker_unconfigured",
        detailFallback: "Music engine is not connected yet.",
      };
    case "worker_overloaded":
      return {
        ctaKey: "vibe.retry",
        ctaFallback: "Retry",
        detailKey: "vibe.gen.worker_overloaded",
        detailFallback: "Music engine is busy — please try again shortly.",
      };
    default:
      return {
        ctaKey: "vibe.retry",
        ctaFallback: "Retry",
        detailKey: "vibe.gen.failed",
        detailFallback: "Didn't brew — tap to retry",
      };
  }
}
