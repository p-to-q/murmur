"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { RotateCcw, Play, Pause, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import Image from "next/image";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { useTranslator, useI18nStore } from "@/lib/i18n";
import { versionPreview } from "@/lib/music/version-preview";
import { generateStrummerCode } from "@/modules/strummer/generate-code";
import {
  applyEdit,
  parsePromptToToken,
  tempoDelta,
  type EditToken,
} from "@/modules/strummer/apply-edit";
import { classifyPromptWithLLM } from "@/lib/api/strummer";
import { memory } from "@/lib/platform/memory";
import { buildDemoFlowStateAsync } from "@/modules/demo/demo-flow";
import {
  bumpVersionEditState,
  resetVersionEditState,
} from "@/modules/music/edit-depth";
import { canSaveHeardVersion, getSaveBlockReason } from "@/modules/music/version-contract";
import type {
  ArrangementState,
  TrackState,
  VibeVersion,
} from "@/modules/shared/types";

import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { buildMeshGradient } from "@/components/song-detail/mesh-gradient";
import {
  coverArtworkImageStyle,
  coverBrightnessCompensationStyle,
} from "@/lib/music/cover-visual-treatment";
import { AurisPanel } from "@/components/studio/auris-panel";
import { TrackMixer } from "@/components/studio/track-mixer";
import { SceneGrid } from "@/components/studio/scene-grid";
import { Turntable } from "@/components/studio/turntable";

export function StudioScreen({ initialDemo = false }: { initialDemo?: boolean }) {
  const router = useRouter();
  const t = useTranslator();
  const currentVersion = useMurmurStore((state) => state.currentVersion);
  const setCurrentVersion = useMurmurStore((state) => state.setCurrentVersion);
  const setVibeVersions = useMurmurStore((state) => state.setVibeVersions);
  const setCurrentDraftId = useMurmurStore((state) => state.setCurrentDraftId);
  const setCurrentFlowId = useMurmurStore((state) => state.setCurrentFlowId);
  const demoSeededRef = useRef(false);
  const demoEnabled = initialDemo;

  useEffect(() => {
    if (!demoEnabled || currentVersion || demoSeededRef.current) {
      return;
    }
    demoSeededRef.current = true;
    void buildDemoFlowStateAsync().then((demo) => {
      setVibeVersions(demo.versions);
      setCurrentDraftId(demo.draftId);
      setCurrentFlowId(demo.flowId);
      setCurrentVersion(demo.currentVersion);
    });
  }, [
    currentVersion,
    demoEnabled,
    setCurrentDraftId,
    setCurrentFlowId,
    setCurrentVersion,
    setVibeVersions,
  ]);

  if (!currentVersion) {
    if (demoEnabled) {
      return (
        <div className="min-h-svh flex flex-col items-center justify-center bg-[#F5F1EB] px-6 text-center">
          <p className="mb-4 text-base text-[#8C8780]">{t("hum.proc.polishing")}</p>
        </div>
      );
    }
    return (
      <div className="min-h-svh flex flex-col items-center justify-center bg-[#F5F1EB] px-6 text-center">
        <p className="mb-4 text-base text-[#8C8780]">{t("studio.empty")}</p>
        <button
          onClick={() => router.push("/")}
          className="text-sm text-[#FF5924] underline underline-offset-4"
        >
          {t("studio.empty.cta")}
        </button>
      </div>
    );
  }

  return <StudioContent version={currentVersion} />;
}

/* ─────────────────────────────────────────────────────────────────────
   StudioContent — the synthesizer-surface layout.
   ───────────────────────────────────────────────────────────────────── */

function StudioContent({ version }: { version: VibeVersion }) {
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const setCurrentVersion = useMurmurStore((state) => state.setCurrentVersion);

  const [isPlaying, setIsPlaying] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);

  useEffect(() => {
    return () => {
      versionPreview.stop();
    };
  }, []);

  const currentVersion = version;
  const arrangement = currentVersion.arrangementState;

  // ── Business logic (unchanged) ─────────────────────────────────────

  const applyTokens = (
    nextVersion: VibeVersion,
    tokens: EditToken[],
  ): VibeVersion => {
    let nextArrangement = nextVersion.arrangementState;
    let nextBpm = nextVersion.melody.bpm;

    for (const token of tokens) {
      nextArrangement = applyEdit(nextArrangement, token);
      nextBpm = Math.max(40, Math.min(200, nextBpm + tempoDelta(token)));
    }

    return bumpVersionEditState({
      ...nextVersion,
      melody: { ...nextVersion.melody, bpm: nextBpm },
      arrangementState: nextArrangement,
      strummerCode: generateStrummerCode(nextArrangement),
    });
  };

  const restartPlayback = (nextVersion: VibeVersion): boolean => {
    versionPreview.stop();
    return versionPreview.play(nextVersion);
  };

  const updateTrack = useCallback(
    (key: keyof ArrangementState, patch: Partial<TrackState>) => {
      const nextArrangement = {
        ...arrangement,
        [key]: { ...arrangement[key], ...patch },
      };
      const nextVersion = bumpVersionEditState({
        ...currentVersion,
        arrangementState: nextArrangement,
        strummerCode: generateStrummerCode(nextArrangement),
      });
      setCurrentVersion(nextVersion);
      if (isPlaying) restartPlayback(nextVersion);
    },
    [arrangement, currentVersion, isPlaying, setCurrentVersion],
  );

  const handleScene = (tokens: EditToken[]) => {
    const nextVersion = applyTokens(currentVersion, tokens);
    setCurrentVersion(nextVersion);
    if (isPlaying) restartPlayback(nextVersion);
  };

  const handlePrompt = async (prompt: string) => {
    setPromptBusy(true);
    try {
      const ruleToken = parsePromptToToken(prompt);
      if (ruleToken) {
        const nextVersion = applyTokens(currentVersion, [ruleToken]);
        setCurrentVersion(nextVersion);
        if (isPlaying) restartPlayback(nextVersion);
        toast.success(t("studio.prompt.applied"));
        memory
          .reportAction({
            content: `Studio rule edit: "${prompt}" -> ${ruleToken}`,
            event_type: "update",
            page: "studio",
            metadata: {
              type: "studio_prompt_rule",
              prompt,
              token: ruleToken,
              source_melody_kind: currentVersion.sourceMelodyKind,
              edit_depth: nextVersion.editDepth,
              edit_count: nextVersion.editCount,
            },
          })
          .catch(() => {});
        return;
      }

      const llmTokens = await classifyPromptWithLLM(prompt);
      if (llmTokens.length > 0) {
        const nextVersion = applyTokens(currentVersion, llmTokens);
        setCurrentVersion(nextVersion);
        if (isPlaying) restartPlayback(nextVersion);
        toast.success(t("studio.prompt.applied"));
        memory
          .reportAction({
            content: `Studio LLM edit: "${prompt}" -> ${llmTokens.join(", ")}`,
            event_type: "update",
            page: "studio",
            metadata: {
              type: "studio_prompt",
              prompt,
              tokens: llmTokens,
              source_melody_kind: currentVersion.sourceMelodyKind,
              edit_depth: nextVersion.editDepth,
              edit_count: nextVersion.editCount,
            },
          })
          .catch(() => {});
        return;
      }

      toast(t("studio.prompt.unknown"));
    } finally {
      setPromptBusy(false);
    }
  };

  const handleRestore = () => {
    const restoredArrangement = applyEdit(arrangement, "restore_all");
    const nextVersion = resetVersionEditState({
      ...currentVersion,
      arrangementState: restoredArrangement,
      strummerCode: generateStrummerCode(restoredArrangement),
    });
    setCurrentVersion(nextVersion);
    if (isPlaying) restartPlayback(nextVersion);
    toast(t("studio.restore_toast"));
    memory
      .reportAction({
        content: `Restored studio arrangement for "${currentVersion.title}"`,
        event_type: "update",
        page: "studio",
        metadata: {
          type: "studio_restore",
          source_melody_kind: currentVersion.sourceMelodyKind,
          edit_depth: nextVersion.editDepth,
          edit_count: nextVersion.editCount,
        },
      })
      .catch(() => {});
  };

  const togglePlay = () => {
    if (isPlaying) {
      versionPreview.stop();
      setIsPlaying(false);
      return;
    }
    if (
      currentVersion.generation &&
      currentVersion.generation.status !== "ready"
    ) {
      toast(t("studio.magenta.pending") || "Audio is still brewing…");
      return;
    }
    setIsPlaying(restartPlayback(currentVersion));
  };

  const handleSave = () => {
    const saveBlockReason = getSaveBlockReason(currentVersion);
    if (!canSaveHeardVersion(currentVersion)) {
      toast(
        saveBlockReason === "generation_failed"
          ? (t("studio.magenta.save_failed") || "This take did not finish rendering. Brew it again before saving.")
          : (t("studio.magenta.save_pending") || "Let this take finish rendering before saving."),
      );
      return;
    }
    versionPreview.stop();
    setIsPlaying(false);
    memory
      .reportAction({
        content: `Studio -> Name flow for "${currentVersion.title}"`,
        event_type: "navigate",
        page: "studio",
        metadata: {
          type: "open_name",
          vibe: currentVersion.vibe,
          source_melody_kind: currentVersion.sourceMelodyKind,
          edit_depth: currentVersion.editDepth,
          edit_count: currentVersion.editCount,
        },
      })
      .catch(() => {});
    router.push("/studio/name");
  };

  // Wave accent color
  const waveAccent =
    extractFirstHex(currentVersion.visualConfig.gradient) ?? "#FF8A5C";

  // Artwork background
  const artwork = currentVersion.visualConfig.artwork;
  const artworkPath = artwork?.backgroundImagePath ?? artwork?.imagePath;
  const meshStyle = buildMeshGradient(currentVersion.visualConfig.gradient, artwork?.palette);

  // Magenta versions are whole generated clips — the per-track mixer and
  // arrangement edits below don't apply to them.
  const magenta = currentVersion.generation;
  const canSave = canSaveHeardVersion(currentVersion);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-svh bg-[#F5F1EB]">
      <PageBackdrop />

      <div className="relative z-10 min-h-svh flex flex-col">
        {/* ── Hero Card — full-width, squared top corners, rounded bottom ─────────── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.06, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative cursor-pointer select-none overflow-hidden flex-shrink-0"
          style={{
            height: "clamp(320px, 62vh, 600px)",
            borderBottomLeftRadius: "24px",
            borderBottomRightRadius: "24px",
          }}
          onClick={togglePlay}
        >
          {/* Mesh gradient + artwork painting */}
          <div className="absolute inset-0" style={meshStyle} />
          {artwork && artworkPath && (
            <Image
              src={artworkPath}
              alt={artwork.title ?? ""}
              fill
              sizes="100vw"
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

          {/* ── Header controls — positioned absolutely inside hero ──────────────────────── */}
          <div
            className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 md:px-8 py-3 z-20"
            style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 24px)" }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); versionPreview.stop(); router.back(); }}
              className="text-[12px] tracking-[0.04em] text-white hover:text-white/70 active:text-[#E5DDD0] transition-colors"
              aria-label={t("studio.back")}
            >
              ← {t("studio.back")}
            </button>
            {!magenta && (
              <button
                onClick={(e) => { e.stopPropagation(); handleRestore(); }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E5DDD0] bg-white/70 transition-colors hover:bg-white"
                aria-label={t("studio.restore_toast")}
              >
                <RotateCcw className="h-3.5 w-3.5 text-[#8C8780]" />
              </button>
            )}
          </div>
            {/* Darken overlays */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/12 via-transparent to-black/48 pointer-events-none" />


            {/* Play disc — center */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.div
                whileTap={{ scale: 0.88 }}
                animate={isPlaying ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                transition={isPlaying ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : {}}
                className={`flex h-16 w-16 items-center justify-center rounded-full border border-white/50 backdrop-blur-sm pointer-events-auto transition-colors ${
                  isPlaying ? "bg-white/28" : "bg-white/12 hover:bg-white/20"
                }`}
              >
                {isPlaying ? (
                  <Pause className="h-6 w-6 text-white" fill="white" />
                ) : (
                  <Play className="ml-1 h-6 w-6 text-white" fill="white" />
                )}
              </motion.div>
            </div>

            {/* Turntable — record + tonearm as one unit; needle drops when playing */}
            <Turntable
              isPlaying={isPlaying}
              accent={waveAccent}
              className="absolute bottom-5 right-5 md:bottom-7 md:right-7 z-10 w-[132px] md:w-[180px] pointer-events-none"
            />

            {/* Song info — lower left; right padding keeps clear of the turntable */}
            <div className="absolute inset-x-0 bottom-0 p-6 pr-40 md:p-8 md:pr-60">
              <p className="text-[10px] uppercase tracking-[0.3em] text-white/55 mb-1.5">
                {magenta ? magenta.vibeLabel[lang] : currentVersion.vibe}
              </p>
              <h2
                className="hero-serif text-white leading-[1.0] md:text-[40px] lg:text-[48px]"
                style={{ fontSize: "clamp(24px, 4vw, 48px)", letterSpacing: "-0.015em" }}
              >
                {currentVersion.title}
              </h2>
              <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-white/40 tabular-nums">
                {currentVersion.melody.bpm} BPM · {currentVersion.melody.key}
              </p>
            </div>
        </motion.div>

        {/* ── Panel wrapper ────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mx-5 md:mx-8 mt-3 relative"
        >
          {/* ── Panel body — the control deck ── */}
          <div
            className="overflow-hidden relative z-[1]"
            style={{
              background: [
                "repeating-linear-gradient(90deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 8px)",
                "repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 24px)",
                "linear-gradient(160deg, #2A2118 0%, #1E1A12 45%, #241D14 100%)",
              ].join(", "),
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
              borderBottomLeftRadius: "22px",
              borderBottomRightRadius: "22px",
            }}
          >
            {/* Breathing room above the prompt bar */}
            <div style={{ height: "14px" }} />

          {magenta ? (
            /* Magenta panel — the clip is one generated whole; show its
               prompt instead of arrangement controls. */
            <div className="px-5 pt-2 pb-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] text-white/45">
                  <Sparkles className="h-3 w-3" />
                  {t("studio.magenta.prompt")}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-white/85">
                  {magenta.prompt}
                </p>
                <p className="mt-3 text-[11px] leading-relaxed text-white/40">
                  {magenta.status === "pending" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("studio.magenta.pending")}
                    </span>
                  ) : (
                    t("studio.magenta.note")
                  )}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Prompt bar */}
              <div className="px-5 pt-2 pb-3">
                <AurisPanel
                  busy={promptBusy}
                  onApply={handlePrompt}
                  variant="dark"
                  showQuickActions={false}
                />
              </div>

              {/* Scene quick-picks */}
              <div className="px-5 pb-4">
                <SceneGrid
                  variant="dark"
                  onPick={(scene) => handleScene(scene.tokens)}
                />
              </div>

              {/* Divider — intent layer ↑ / granular control ↓ */}
              <div className="mx-5 h-px bg-white/8" />

              {/* Guitar string faders */}
              <div className="px-5 pt-4 pb-2">
                <TrackMixer
                  variant="strings"
                  arrangement={arrangement}
                  onTrack={updateTrack}
                  isPlaying={isPlaying}
                />
              </div>
            </>
          )}

          {/* Save button inside the panel */}
          <div className="px-5 pt-3">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleSave}
              disabled={!canSave}
              className="w-full rounded-full bg-white text-[14px] font-medium text-[#1A1A1A] transition-colors hover:bg-[#F5F1EB]"
              style={{ height: "52px" }}
            >
              {t("studio.save")} →
            </motion.button>
          </div>
          {/* close panel body */}
          </div>
        </motion.div>

        {/* Bottom breathing room */}
        <div className="h-8" />
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function extractFirstHex(gradient: string): string | null {
  const m = gradient.match(/#([0-9a-fA-F]{6})/);
  return m ? `#${m[1]}` : null;
}
