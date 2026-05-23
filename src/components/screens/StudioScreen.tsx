"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, RotateCcw, Play, Pause } from "lucide-react";
import { toast } from "sonner";
import { memory } from "@eazo/sdk";

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
import { renderAudio } from "@/modules/export/render-mp3";
import type {
  ArrangementState,
  TrackState,
  VibeVersion,
} from "@/modules/shared/types";

import { AurisPanel } from "@/components/studio/auris-panel";
import { TrackMixer } from "@/components/studio/track-mixer";
import { SceneGrid } from "@/components/studio/scene-grid";

export function StudioScreen() {
  // Studio is intentionally not a DAW. It compresses arrangement control into
  // three legible surfaces: direct track shaping, mood/scene shifts, and a
  // natural-language AI edit path. The goal is guided authorship, not maximal knobs.
  const router = useRouter();
  const t = useTranslator();
  const currentVersion = useMurmurStore((state) => state.currentVersion);

  if (!currentVersion) {
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

function StudioContent({ version }: { version: VibeVersion }) {
  const router = useRouter();
  const t = useTranslator();
  const setCurrentVersion = useMurmurStore((state) => state.setCurrentVersion);

  const [isSaving, setIsSaving] = useState(false);
  const [savingHint, setSavingHint] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);

  const currentVersion = version;
  const arrangement = currentVersion.arrangementState;

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

    return {
      ...nextVersion,
      melody: { ...nextVersion.melody, bpm: nextBpm },
      arrangementState: nextArrangement,
      strummerCode: generateStrummerCode(nextArrangement),
    };
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
      const nextVersion: VibeVersion = {
        ...currentVersion,
        arrangementState: nextArrangement,
        strummerCode: generateStrummerCode(nextArrangement),
      };
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
            content: `Studio LLM edit: "${prompt}" → ${llmTokens.join(", ")}`,
            event_type: "update",
            page: "studio",
            metadata: { type: "studio_prompt", prompt, tokens: llmTokens },
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
    const nextVersion: VibeVersion = {
      ...currentVersion,
      arrangementState: restoredArrangement,
      strummerCode: generateStrummerCode(restoredArrangement),
    };
    setCurrentVersion(nextVersion);
    if (isPlaying) restartPlayback(nextVersion);
    toast(t("studio.restore_toast"));
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

  const handleSave = async () => {
    if (isSaving) return;

    setIsSaving(true);
    setSavingHint(t("studio.rendering"));
    synth.stop();
    setIsPlaying(false);

    const id = crypto.randomUUID();
    let mp3DataUrl: string | undefined;

    try {
      const rendered = await renderAudio(currentVersion);
      if (rendered) mp3DataUrl = rendered.dataUrl;
    } catch (error) {
      console.warn("[Studio] render failed, saving without audio:", error);
    }

    try {
      const response = await fetch("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          userId: "guest",
          title: currentVersion.title,
          vibe: currentVersion.vibe,
          vibeEn: currentVersion.title,
          bpm: currentVersion.melody.bpm,
          keySignature: currentVersion.melody.key.split(" ")[0] ?? "C",
          scaleType: currentVersion.melody.scale,
          duration: Math.round(currentVersion.melody.duration),
          mp3DataUrl,
          visualConfig: currentVersion.visualConfig,
          arrangementState: arrangement,
          tags: currentVersion.tags,
        }),
      });
      if (!response.ok) throw new Error(`Save HTTP ${response.status}`);

      memory
        .reportAction({
          content: `Saved "${currentVersion.title}" (audio: ${mp3DataUrl ? "yes" : "no"})`,
          event_type: "create",
          page: "studio",
          metadata: {
            type: "save_song",
            song_id: id,
            has_audio: !!mp3DataUrl,
          },
        })
        .catch(() => {});

      toast.success(t("studio.save_ok"));
      router.push(`/song/${id}`);
    } catch (error) {
      console.error("[Studio] save failed:", error);
      toast.error(t("studio.save_err"));
    } finally {
      setIsSaving(false);
      setSavingHint("");
    }
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#EEEDF2]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="aurora-blob-2 absolute rounded-full"
          style={{
            width: "min(52vw, 520px)",
            height: "min(42vw, 420px)",
            right: "-10%",
            top: "3%",
            background:
              "radial-gradient(ellipse at center, rgba(201,182,228,0.24) 0%, rgba(200,180,240,0.06) 55%, transparent 75%)",
            filter: "blur(55px)",
          }}
        />
        <div
          className="aurora-blob-3 absolute rounded-full"
          style={{
            width: "min(44vw, 430px)",
            height: "min(38vw, 360px)",
            left: "-6%",
            top: "26%",
            background:
              "radial-gradient(ellipse at center, rgba(255,200,140,0.18) 0%, rgba(255,180,100,0.05) 55%, transparent 75%)",
            filter: "blur(50px)",
          }}
        />
      </div>

      <div className="relative z-10 min-h-svh flex flex-col">
        <div
          className="flex items-center justify-between px-5 pb-5 md:px-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
        >
          <button
            onClick={() => {
              synth.stop();
              router.back();
            }}
            aria-label={t("studio.back")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70"
          >
            <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
          </button>

          <div className="text-center">
            <p
              className="font-serif text-[17px] leading-tight text-[#1A1A1A]"
              style={{ letterSpacing: "-0.005em" }}
            >
              {currentVersion.title}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[#8C8780]">
              {currentVersion.vibe} · {currentVersion.melody.bpm} BPM
            </p>
          </div>

          <button
            onClick={handleRestore}
            aria-label={t("studio.restore")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70"
          >
            <RotateCcw className="h-4 w-4 text-[#8C8780]" />
          </button>
        </div>

        <div className="px-5 pb-32 md:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
              <div
                className="relative min-h-[220px] cursor-pointer select-none overflow-hidden rounded-[34px] border border-white/55 shadow-[0_22px_60px_rgba(26,26,26,0.10)]"
                style={{ background: currentVersion.visualConfig.gradient }}
                onClick={togglePlay}
              >
                <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/40" />
                <div className="absolute left-6 right-6 top-6 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-white/72">
                      {currentVersion.vibe}
                    </p>
                    <p
                      className="mt-3 max-w-[24rem] font-serif text-[30px] leading-[0.98] text-white md:text-[42px]"
                      style={{ letterSpacing: "-0.02em" }}
                    >
                      {currentVersion.title}
                    </p>
                  </div>
                  <div className="rounded-full border border-white/50 bg-white/18 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/78 backdrop-blur-sm">
                    {currentVersion.melody.bpm} bpm
                  </div>
                </div>
                <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between gap-5">
                  <p className="max-w-[22rem] text-[13px] leading-[1.55] text-white/78">
                    {t("studio.hero.sub")}
                  </p>
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-full border border-white/60 backdrop-blur-sm ${
                      isPlaying ? "bg-white/35" : "bg-white/20"
                    }`}
                  >
                    {isPlaying ? (
                      <Pause className="h-5 w-5 text-white" fill="white" />
                    ) : (
                      <Play className="ml-0.5 h-5 w-5 text-white" fill="white" />
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-[34px] border border-[#E7DDCF] bg-[linear-gradient(180deg,rgba(255,254,251,0.98),rgba(248,243,234,0.98))] p-6 shadow-[0_22px_60px_rgba(26,26,26,0.07)]">
                <p className="eyebrow mb-2 text-[#FF8A5C]">
                  {t("studio.overview.eyebrow")}
                </p>
                <h2 className="font-serif text-[28px] leading-[1.02] text-[#1A1A1A] md:text-[34px]">
                  {t("studio.overview.title")}
                </h2>
                <p className="mt-3 text-[14px] leading-[1.65] text-[#6F6A63]">
                  {t("studio.overview.sub")}
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  <MetaPill
                    label={t("song.meta.vibe")}
                    value={currentVersion.vibe}
                  />
                  <MetaPill
                    label={t("song.meta.key")}
                    value={currentVersion.melody.key}
                  />
                  <MetaPill
                    label={t("song.meta.bpm")}
                    value={String(currentVersion.melody.bpm)}
                  />
                  <MetaPill
                    label={t("track.melody")}
                    value={currentVersion.arrangementState.melody.instrument}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <AurisPanel busy={promptBusy} onApply={handlePrompt} />
              <TrackMixer arrangement={arrangement} onTrack={updateTrack} />
              <SceneGrid onPick={(scene) => handleScene(scene.tokens)} />
            </div>
          </div>
        </div>

        <div
          className="fixed left-0 right-0 bg-gradient-to-t from-[#EEEDF2] via-[#EEEDF2] to-transparent px-5 pt-4 md:left-[240px] md:px-8"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)",
          }}
        >
          <div className="mx-auto max-w-6xl">
            {savingHint ? (
              <p className="mb-2 text-center text-xs text-[#8C8780]">
                {savingHint}
              </p>
            ) : null}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleSave}
              disabled={isSaving}
              className="h-14 w-full rounded-[22px] bg-[#1A1A1A] text-base font-medium text-white disabled:opacity-50"
            >
              {isSaving ? t("studio.saving") : t("studio.save")}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-[#E8DECF] bg-white/68 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[#B3AA9C]">
        {label}
      </p>
      <p className="mt-1 text-[13px] text-[#1A1A1A]">{value}</p>
    </div>
  );
}
