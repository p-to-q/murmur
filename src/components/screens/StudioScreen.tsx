"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, RotateCcw, Play, Pause } from "lucide-react";
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
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 min-h-svh flex flex-col">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 pb-4 md:px-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
        >
          <button
            onClick={() => {
              synth.stop();
              router.back();
            }}
            aria-label={t("studio.back")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E5DDD0] bg-white/70 transition-colors hover:bg-white"
          >
            <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
          </button>

          <div className="text-center min-w-0">
            <p
              className="font-serif text-[17px] leading-tight text-[#1A1A1A] truncate"
              style={{ letterSpacing: "-0.005em" }}
            >
              {currentVersion.title}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-[#8C8780]">
              {currentVersion.vibe} · {currentVersion.melody.bpm} BPM
            </p>
          </div>

          <button
            onClick={handleRestore}
            aria-label={t("studio.restore")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E5DDD0] bg-white/70 transition-colors hover:bg-white"
          >
            <RotateCcw className="h-4 w-4 text-[#8C8780]" />
          </button>
        </div>

        {/* ── Main content ────────────────────────────────────────── */}
        <div className="flex-1 px-5 md:px-8 pb-28">
          <div className="mx-auto max-w-6xl">
            {/* Display + Controls — desktop side by side */}
            <div className="grid gap-5 md:grid-cols-[1.15fr_1fr]">
              {/* ── DISPLAY ZONE: gradient cover ─────────────────── */}
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="relative min-h-[280px] md:min-h-[420px] cursor-pointer select-none overflow-hidden rounded-[28px] border border-white/30"
                style={{ background: currentVersion.visualConfig.gradient }}
                onClick={togglePlay}
              >
                {/* Top darken for legibility */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/12 via-transparent to-black/36 pointer-events-none" />

                {/* MurmurWave in bottom half */}
                <MurmurWave
                  color={waveAccent}
                  intensity={0.5}
                  isPlaying={isPlaying}
                  waveY={0.55}
                  className="absolute inset-x-0 bottom-0 h-2/5 w-full pointer-events-none"
                />

                {/* Text — positioned in lower third */}
                <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
                  <p className="text-[10px] uppercase tracking-[0.28em] text-white/65">
                    {currentVersion.vibe}
                  </p>
                  <h1
                    className="mt-2 hero-serif text-white text-[28px] leading-[1.02] md:text-[42px] max-w-[22rem]"
                    style={{ letterSpacing: "-0.015em" }}
                  >
                    {currentVersion.title}
                  </h1>
                </div>

                {/* Play disc — centered */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <motion.div
                    whileTap={{ scale: 0.92 }}
                    className={`flex h-14 w-14 items-center justify-center rounded-full border border-white/50 backdrop-blur-sm pointer-events-auto ${
                      isPlaying ? "bg-white/30" : "bg-white/16"
                    }`}
                  >
                    {isPlaying ? (
                      <Pause className="h-5 w-5 text-white" fill="white" />
                    ) : (
                      <Play className="ml-0.5 h-5 w-5 text-white" fill="white" />
                    )}
                  </motion.div>
                </div>
              </motion.div>

              {/* ── CONTROLS ZONE ────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col gap-5"
              >
                {/* Auris input */}
                <AurisPanel
                  busy={promptBusy}
                  onApply={handlePrompt}
                />

                {/* Scenes — desktop only */}
                <SceneGrid
                  onPick={(scene) => handleScene(scene.tokens)}
                  className="hidden md:block"
                />
              </motion.div>
            </div>

            {/* ── FADER ZONE ──────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8 rounded-[22px] border border-[#E5DDD0] bg-white/50 p-5 md:p-7 backdrop-blur-sm"
            >
              <TrackMixer arrangement={arrangement} onTrack={updateTrack} />
            </motion.div>
          </div>
        </div>

        {/* ── Fixed Save button ────────────────────────────────────── */}
        <div
          className="fixed left-0 right-0 bg-gradient-to-t from-[#F5F1EB] via-[#F5F1EB]/95 to-transparent px-5 pt-6 pb-5 md:px-8"
          style={{
            left: "var(--side-nav-w)",
            bottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <div className="mx-auto max-w-6xl">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleSave}
              className="h-14 w-full rounded-full bg-[#1A1A1A] text-[15px] font-medium text-white transition-opacity hover:bg-[#2A2A2A]"
            >
              {t("studio.save")}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function extractFirstHex(gradient: string): string | null {
  const m = gradient.match(/#([0-9a-fA-F]{6})/);
  return m ? `#${m[1]}` : null;
}
