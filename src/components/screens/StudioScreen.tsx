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
import type { ArrangementState, TrackState, VibeVersion } from "@/modules/shared/types";

import { TrackMixer } from "@/components/studio/track-mixer";
import { SceneGrid } from "@/components/studio/scene-grid";
import { PromptBar } from "@/components/studio/prompt-bar";

export function StudioScreen() {
  const router = useRouter();
  const t = useTranslator();
  const currentVersion = useMurmurStore((s) => s.currentVersion);

  if (!currentVersion) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center bg-[#F5F1EB] px-6 text-center">
        <p className="text-[#8C8780] text-base mb-4">{t("studio.empty")}</p>
        <button
          onClick={() => router.push("/")}
          className="text-[#FF5924] text-sm underline underline-offset-4"
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
  const setCurrentVersion = useMurmurStore((s) => s.setCurrentVersion);

  const [isSaving, setIsSaving] = useState(false);
  const [savingHint, setSavingHint] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);

  // Keep a reference to the latest version (state inside the store) so the
  // callbacks below always read what the user just saw, not a stale snapshot.
  const currentVersion = version;
  const arr = currentVersion.arrangementState;

  // ── Apply a sequence of edit tokens to currentVersion ───────────────
  const applyTokens = (version: VibeVersion, tokens: EditToken[]): VibeVersion => {
    let nextArr = version.arrangementState;
    let nextBpm = version.melody.bpm;
    for (const token of tokens) {
      nextArr = applyEdit(nextArr, token);
      nextBpm = Math.max(40, Math.min(200, nextBpm + tempoDelta(token)));
    }
    return {
      ...version,
      melody: { ...version.melody, bpm: nextBpm },
      arrangementState: nextArr,
      strummerCode: generateStrummerCode(nextArr),
    };
  };

  // ── Restart synth with the current version's state ──────────────────
  const restartPlayback = (version: VibeVersion) => {
    synth.stop();
    synth.play(version);
  };

  const updateTrack = useCallback(
    (key: keyof ArrangementState, patch: Partial<TrackState>) => {
      const next: VibeVersion = {
        ...currentVersion,
        arrangementState: {
          ...arr,
          [key]: { ...arr[key], ...patch },
        },
        strummerCode: generateStrummerCode({ ...arr, [key]: { ...arr[key], ...patch } }),
      };
      setCurrentVersion(next);
      if (isPlaying) restartPlayback(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arr, currentVersion, isPlaying]
  );

  // ── Scene preset ────────────────────────────────────────────────────
  const handleScene = (tokens: EditToken[]) => {
    const next = applyTokens(currentVersion, tokens);
    setCurrentVersion(next);
    if (isPlaying) restartPlayback(next);
  };

  // ── Prompt: rule-based first, LLM fallback ──────────────────────────
  const handlePrompt = async (prompt: string) => {
    setPromptBusy(true);
    try {
      const ruleToken = parsePromptToToken(prompt);
      if (ruleToken) {
        const next = applyTokens(currentVersion, [ruleToken]);
        setCurrentVersion(next);
        if (isPlaying) restartPlayback(next);
        toast.success(t("studio.prompt.applied"));
        return;
      }
      const llmTokens = await classifyPromptWithLLM(prompt);
      if (llmTokens.length > 0) {
        const next = applyTokens(currentVersion, llmTokens);
        setCurrentVersion(next);
        if (isPlaying) restartPlayback(next);
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

  // ── Restore ─────────────────────────────────────────────────────────
  const handleRestore = () => {
    const restored = applyEdit(arr, "restore_all");
    const next: VibeVersion = {
      ...currentVersion,
      arrangementState: restored,
      strummerCode: generateStrummerCode(restored),
    };
    setCurrentVersion(next);
    if (isPlaying) restartPlayback(next);
    toast(t("studio.restore_toast"));
  };

  // ── Play / pause ────────────────────────────────────────────────────
  const togglePlay = () => {
    if (isPlaying) {
      synth.stop();
      setIsPlaying(false);
    } else {
      restartPlayback(currentVersion);
      setIsPlaying(true);
    }
  };

  // ── Save (renders MP3 first, then writes DB) ────────────────────────
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
    } catch (e) {
      console.warn("[Studio] render failed, saving without audio:", e);
    }

    try {
      const res = await fetch("/api/songs", {
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
          arrangementState: arr,
          tags: currentVersion.tags,
        }),
      });
      if (!res.ok) throw new Error(`Save HTTP ${res.status}`);

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
    } catch (err) {
      console.error("[Studio] save failed:", err);
      toast.error(t("studio.save_err"));
    } finally {
      setIsSaving(false);
      setSavingHint("");
    }
  };

  return (
    <div className="min-h-svh bg-[#F5F1EB] flex flex-col">
      {/* Header — safe-area-aware */}
      <div
        className="flex items-center justify-between px-5 pb-4"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
      >
        <button
          onClick={() => {
            synth.stop();
            router.back();
          }}
          aria-label={t("studio.back")}
          className="w-9 h-9 rounded-full bg-[#EFE8DA] flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-[#1A1A1A]" />
        </button>
        <div className="text-center">
          <p
            className="font-serif text-[#1A1A1A] text-[17px] leading-tight"
            style={{ letterSpacing: "-0.005em" }}
          >
            {currentVersion.title}
          </p>
          <p className="text-[#8C8780] text-[11px] mt-1 tracking-[0.14em] uppercase">
            {currentVersion.vibe} · {currentVersion.melody.bpm} BPM
          </p>
        </div>
        <button
          onClick={handleRestore}
          aria-label={t("studio.restore")}
          className="w-9 h-9 rounded-full bg-[#EFE8DA] flex items-center justify-center"
        >
          <RotateCcw className="w-4 h-4 text-[#8C8780]" />
        </button>
      </div>

      {/* Visual card + play */}
      <div
        className="mx-5 rounded-3xl overflow-hidden relative mb-5 cursor-pointer select-none"
        style={{ height: 160, background: currentVersion.visualConfig.gradient }}
        onClick={togglePlay}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/35" />
        <div className="absolute bottom-4 left-5 right-5">
          <p className="text-white/65 text-[10px] tracking-[0.28em] uppercase mb-1">
            {currentVersion.vibe}
          </p>
          <p
            className="font-serif text-white text-[22px] leading-tight"
            style={{ letterSpacing: "-0.01em" }}
          >
            {currentVersion.title}
          </p>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 border-white/60 ${
              isPlaying ? "bg-white/35" : "bg-white/20"
            }`}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 text-white" fill="white" />
            ) : (
              <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
            )}
          </div>
        </div>
      </div>

      {/* Edit zone */}
      <div className="flex-1 overflow-y-auto px-5 pb-32 space-y-5">
        <TrackMixer arrangement={arr} onTrack={updateTrack} />
        <SceneGrid onPick={(scene) => handleScene(scene.tokens)} />
        <PromptBar busy={promptBusy} onApply={handlePrompt} />
      </div>

      {/* Sticky save button — clear of bottom nav + safe area */}
      <div
        className="fixed left-0 right-0 px-5 pt-4 bg-gradient-to-t from-[#F5F1EB] via-[#F5F1EB] to-transparent md:left-[240px]"
        style={{
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)",
        }}
      >
        {savingHint ? (
          <p className="text-center text-[#8C8780] text-xs mb-2">{savingHint}</p>
        ) : null}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleSave}
          disabled={isSaving}
          className="w-full h-14 rounded-2xl bg-[#1A1A1A] text-white text-base font-medium disabled:opacity-50"
        >
          {isSaving ? t("studio.saving") : t("studio.save")}
        </motion.button>
      </div>
    </div>
  );
}
