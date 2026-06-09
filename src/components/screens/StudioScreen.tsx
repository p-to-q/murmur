"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { RotateCcw, Play, Pause } from "lucide-react";
import { toast } from "sonner";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { useTranslator } from "@/lib/i18n";
import { synth } from "@/lib/music/simple-synth";
import { generateStrummerCode } from "@/modules/strummer/generate-code";
import {
  applyEdit,
  parsePromptToToken,
  tempoDelta,
  type EditToken,
} from "@/modules/strummer/apply-edit";
import { classifyPromptWithLLM } from "@/lib/api/strummer";
import { memory } from "@/lib/platform/memory";
import { buildDemoFlowState } from "@/modules/demo/demo-flow";
import {
  bumpVersionEditState,
  resetVersionEditState,
} from "@/modules/music/edit-depth";
import type {
  ArrangementState,
  TrackState,
  VibeVersion,
} from "@/modules/shared/types";

import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurWave } from "@/components/murmur/murmur-wave";
import { AurisPanel } from "@/components/studio/auris-panel";
import { TrackMixer } from "@/components/studio/track-mixer";
import { SceneGrid } from "@/components/studio/scene-grid";
import { VinylDisc } from "@/components/studio/vinyl-disc";

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
    const demo = buildDemoFlowState();
    setVibeVersions(demo.versions);
    setCurrentDraftId(demo.draftId);
    setCurrentFlowId(demo.flowId);
    setCurrentVersion(demo.currentVersion);
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
  const setCurrentVersion = useMurmurStore((state) => state.setCurrentVersion);

  const [isPlaying, setIsPlaying] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);

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

  const restartPlayback = (nextVersion: VibeVersion) => {
    synth.stop();
    synth.play(nextVersion);
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
      synth.stop();
      setIsPlaying(false);
      return;
    }
    restartPlayback(currentVersion);
    setIsPlaying(true);
  };

  const handleSave = () => {
    synth.stop();
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
            background: currentVersion.visualConfig.gradient,
            height: "clamp(320px, 62vh, 600px)",
            borderBottomLeftRadius: "24px",
            borderBottomRightRadius: "24px",
          }}
          onClick={togglePlay}
        >
          {/* ── Header controls — positioned absolutely inside hero ──────────────────────── */}
          <div
            className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 md:px-8 py-3 z-20"
            style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 24px)" }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); synth.stop(); router.back(); }}
              className="text-[12px] tracking-[0.04em] text-white hover:text-white/70 active:text-[#E5DDD0] transition-colors"
            >
              ← {t("studio.back")}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleRestore(); }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E5DDD0] bg-white/70 transition-colors hover:bg-white"
            >
              <RotateCcw className="h-3.5 w-3.5 text-[#8C8780]" />
            </button>
          </div>
            {/* Darken overlays */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/12 via-transparent to-black/48 pointer-events-none" />

            {/* Wave */}
            <MurmurWave
              color={waveAccent}
              intensity={0.62}
              isPlaying={isPlaying}
              waveY={0.46}
              className="absolute inset-x-0 bottom-0 h-[55%] w-full pointer-events-none"
            />

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

            {/* Tonearm — pivots at bottom-right corner */}
            <div className="absolute bottom-6 right-6 md:bottom-8 md:right-8 pointer-events-none z-10">
              <motion.svg
                className="w-28 h-28 md:w-40 md:h-40"
                viewBox="0 0 100 100" fill="none"
                style={{ transformOrigin: "82% 82%" }}
                initial={false}
                animate={{ rotate: isPlaying ? -26 : 0 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                <line x1="82" y1="82" x2="24" y2="28" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" />
                <rect x="16" y="22" width="14" height="5" rx="1.5" fill="rgba(255,255,255,0.5)" transform="rotate(-42, 23, 24.5)" />
                <circle cx="18" cy="24" r="1.5" fill="rgba(255,255,255,0.7)" />
                <circle cx="82" cy="82" r="6" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                <circle cx="82" cy="82" r="2.5" fill="rgba(255,255,255,0.4)" />
                <circle cx="72" cy="73" r="4" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
              </motion.svg>
            </div>

            {/* Song info — lower left */}
            <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
              <p className="text-[10px] uppercase tracking-[0.3em] text-white/55 mb-1.5">
                {currentVersion.vibe}
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

        {/* ── Panel wrapper — disc protrudes above the frame ─────── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mx-4 md:mx-8 mt-3 relative"
          style={{ paddingTop: "40px" }}
        >
          {/* ── Vinyl disc — floats above panel, drops into slot ──── */}
          <div
            className="absolute pointer-events-none"
            style={{ left: "28px", top: "0" }}
          >
            <VinylDisc
              isPlaying={isPlaying}
              accent={waveAccent}
              size={92}
            />
          </div>

          {/* ── Panel body — z-[1] so it covers the disc's lower half ── */}
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
            {/* ── Disc slot groove — the slit the disc inserts into ── */}
            <div className="relative pointer-events-none" style={{ height: "28px" }}>
              {/* Slot opening — recessed channel */}
              <div
                className="absolute left-0 right-0"
                style={{
                  top: "12px",
                  height: "4px",
                  background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.18) 100%)",
                  boxShadow: "0 1px 0 rgba(255,255,255,0.04), inset 0 1.5px 3px rgba(0,0,0,0.45)",
                }}
              />
            </div>

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

          {/* Save button inside the panel */}
          <div className="px-5 pt-3">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleSave}
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
