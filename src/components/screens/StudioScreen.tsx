"use client";

/**
 * StudioScreen — Compose v2 (three planes).
 *
 * Specced in docs/studio-compose-redesign.md + docs/page-redesign.md §4.
 *
 * Plane 1 (Listen): hero cover + play + meta + "Tweak this song" link +
 *                   Save (black capsule, bottom-anchored).
 * Plane 2 (Tweak):  slides up over Listen. Five scene cards + a single
 *                   Auris input + Undo/Restore pills + "Fine-tune mix" link.
 * Plane 3 (Balance): slides up over Tweak. Existing TrackMixer.
 *
 * Data contracts (unchanged from v1):
 *   - reads useMurmurStore.currentVersion (a VibeVersion)
 *   - mutates via applyEdit + tempoDelta + setCurrentVersion
 *   - LLM edit via classifyPromptWithLLM
 *   - Save commits via router.push("/studio/name")
 *   - SimpleSynth handles playback
 *
 * Studio v1 (339 lines, 28+ controls) is replaced wholesale; sub-components
 * (AurisPanel, SceneGrid, TrackMixer) keep their files but TrackMixer is the
 * only one still mounted directly. Auris + scenes are inlined here so the
 * Plane 2 surface stays a single visual unit.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Play, Pause, RotateCcw, Undo2, Sliders } from "lucide-react";
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
import type {
  ArrangementState,
  TrackState,
  VibeVersion,
} from "@/modules/shared/types";

import { TrackMixer } from "@/components/studio/track-mixer";
import { SCENES, type Scene } from "@/components/studio/scene-presets";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurWave } from "@/components/murmur/murmur-wave";

/** Pull the first `#rrggbb` out of a CSS gradient string so the wave layer
 *  inherits the vibe's hue. Falls back to the coral accent if parsing fails. */
function pickAccentHex(gradient: string): string {
  const m = gradient.match(/#([0-9a-fA-F]{6})/);
  return m ? `#${m[1]}` : "#FF8A5C";
}

const UNDO_DEPTH = 10;

/** Until Phase 4 wires `useEntitlement`, Save stays unconditionally enabled.
 *  Codex flips this to `useEntitlement().canSave` per docs/user-model.md §5. */
const CAN_SAVE_STUB = true;

export function StudioScreen() {
  const router = useRouter();
  const t = useTranslator();
  const currentVersion = useMurmurStore((s) => s.currentVersion);

  if (!currentVersion) {
    return (
      <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
        <PageBackdrop />
        <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
          <p className="eyebrow mb-4 text-[#FF8A5C]">{t("studio.empty.eyebrow") || "NOTHING TO COMPOSE"}</p>
          <h1 className="hero-serif text-[32px] leading-[1.05] text-[#1A1A1A] md:text-[44px]">
            {t("studio.empty")}
          </h1>
          <button
            onClick={() => router.push("/")}
            className="mm-btn-primary mt-8"
          >
            {t("studio.empty.cta")}
          </button>
        </div>
      </div>
    );
  }

  return <StudioContent version={currentVersion} />;
}

/* ─────────────────────────────────────────────────────────────────────
   StudioContent — owns plane state, undo stack, playback.
   ───────────────────────────────────────────────────────────────────── */

type Plane = 1 | 2 | 3;

function StudioContent({ version }: { version: VibeVersion }) {
  const router = useRouter();
  const t = useTranslator();
  const setCurrentVersion = useMurmurStore((s) => s.setCurrentVersion);

  const [plane, setPlane] = useState<Plane>(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [undoStack, setUndoStack] = useState<VibeVersion[]>([]);

  // Stop playback whenever we navigate away or unmount.
  useEffect(() => {
    return () => {
      synth.stop();
    };
  }, []);

  const restartIfPlaying = useCallback(
    (next: VibeVersion) => {
      if (isPlaying) {
        synth.stop();
        synth.play(next);
      }
    },
    [isPlaying],
  );

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      synth.stop();
      setIsPlaying(false);
      return;
    }
    synth.play(version);
    setIsPlaying(true);
  }, [isPlaying, version]);

  /* ── Mutation pipeline ─────────────────────────────────────────────── */

  const pushUndo = useCallback((snapshot: VibeVersion) => {
    setUndoStack((prev) => {
      const next = [...prev, snapshot];
      if (next.length > UNDO_DEPTH) next.shift();
      return next;
    });
  }, []);

  const applyTokens = useCallback(
    (tokens: EditToken[]): VibeVersion => {
      let nextArrangement = version.arrangementState;
      let nextBpm = version.melody.bpm;
      for (const token of tokens) {
        nextArrangement = applyEdit(nextArrangement, token);
        nextBpm = Math.max(40, Math.min(200, nextBpm + tempoDelta(token)));
      }
      return {
        ...version,
        melody: { ...version.melody, bpm: nextBpm },
        arrangementState: nextArrangement,
        strummerCode: generateStrummerCode(nextArrangement),
      };
    },
    [version],
  );

  const commit = useCallback(
    (next: VibeVersion) => {
      pushUndo(version);
      setCurrentVersion(next);
      restartIfPlaying(next);
    },
    [pushUndo, restartIfPlaying, setCurrentVersion, version],
  );

  const handleScene = useCallback(
    (scene: Scene) => {
      commit(applyTokens(scene.tokens));
      memory
        .reportAction({
          content: `Scene "${scene.id}" applied`,
          event_type: "update",
          page: "studio",
          metadata: { type: "scene_apply", scene_id: scene.id, tokens: scene.tokens },
        })
        .catch(() => {});
    },
    [applyTokens, commit],
  );

  const handlePrompt = useCallback(
    async (prompt: string) => {
      setPromptBusy(true);
      try {
        const ruleToken = parsePromptToToken(prompt);
        if (ruleToken) {
          commit(applyTokens([ruleToken]));
          toast.success(t("studio.prompt.applied"));
          return;
        }
        const llmTokens = await classifyPromptWithLLM(prompt);
        if (llmTokens.length > 0) {
          commit(applyTokens(llmTokens));
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
    },
    [applyTokens, commit, t],
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1]!;
    setUndoStack((prev) => prev.slice(0, -1));
    setCurrentVersion(last);
    restartIfPlaying(last);
  }, [restartIfPlaying, setCurrentVersion, undoStack]);

  const handleRestoreAll = useCallback(() => {
    const restored: VibeVersion = {
      ...version,
      arrangementState: applyEdit(version.arrangementState, "restore_all"),
      strummerCode: generateStrummerCode(
        applyEdit(version.arrangementState, "restore_all"),
      ),
    };
    pushUndo(version);
    setCurrentVersion(restored);
    setUndoStack([]); // restore resets history
    restartIfPlaying(restored);
    toast(t("studio.restore_toast"));
  }, [pushUndo, restartIfPlaying, setCurrentVersion, t, version]);

  const handleTrackChange = useCallback(
    (key: keyof ArrangementState, patch: Partial<TrackState>) => {
      const nextArrangement = {
        ...version.arrangementState,
        [key]: { ...version.arrangementState[key], ...patch },
      };
      const next: VibeVersion = {
        ...version,
        arrangementState: nextArrangement,
        strummerCode: generateStrummerCode(nextArrangement),
      };
      commit(next);
    },
    [commit, version],
  );

  const handleSave = useCallback(() => {
    if (!CAN_SAVE_STUB) return;
    synth.stop();
    setIsPlaying(false);
    memory
      .reportAction({
        content: `Studio → Name for "${version.title}"`,
        event_type: "navigate",
        page: "studio",
        metadata: { type: "save_proceed", vibe: version.vibe },
      })
      .catch(() => {});
    router.push("/studio/name");
  }, [router, version]);

  const handleBack = useCallback(() => {
    if (plane === 3) return setPlane(2);
    if (plane === 2) return setPlane(1);
    synth.stop();
    router.back();
  }, [plane, router]);

  /* ── Render ───────────────────────────────────────────────────────── */

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <ListenPlane
        version={version}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        onTweak={() => setPlane(2)}
        onSave={handleSave}
        onBack={handleBack}
        onRestoreAll={handleRestoreAll}
        canSave={CAN_SAVE_STUB}
        dimmed={plane > 1}
      />

      <AnimatePresence>
        {plane >= 2 && (
          <TweakPlane
            key="tweak"
            version={version}
            promptBusy={promptBusy}
            canUndo={undoStack.length > 0}
            onScene={handleScene}
            onPrompt={handlePrompt}
            onUndo={handleUndo}
            onRestoreAll={handleRestoreAll}
            onFineTune={() => setPlane(3)}
            onBack={() => setPlane(1)}
            onSave={handleSave}
            canSave={CAN_SAVE_STUB}
            dimmed={plane === 3}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {plane === 3 && (
          <BalancePlane
            key="balance"
            arrangement={version.arrangementState}
            onTrack={handleTrackChange}
            onBack={() => setPlane(2)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Plane 1 — Listen
   ───────────────────────────────────────────────────────────────────── */

function ListenPlane({
  version,
  isPlaying,
  onTogglePlay,
  onTweak,
  onSave,
  onBack,
  onRestoreAll,
  canSave,
  dimmed,
}: {
  version: VibeVersion;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onTweak: () => void;
  onSave: () => void;
  onBack: () => void;
  onRestoreAll: () => void;
  canSave: boolean;
  dimmed: boolean;
}) {
  const t = useTranslator();
  const duration = Math.round(version.melody.duration);
  const durLabel = useMemo(() => {
    const m = Math.floor(duration / 60);
    const s = duration % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [duration]);

  return (
    <motion.div
      className="relative z-10 min-h-svh flex flex-col"
      animate={{
        scale: dimmed ? 0.96 : 1,
        opacity: dimmed ? 0.35 : 1,
        filter: dimmed ? "blur(2px)" : "blur(0px)",
      }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={{ pointerEvents: dimmed ? "none" : "auto" }}
    >
      <Header
        center={
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
            {version.vibe} · {version.melody.bpm} BPM
          </p>
        }
        onBack={onBack}
        onRestore={onRestoreAll}
        restoreAria={t("studio.restore")}
      />

      <div className="flex-1 px-5 md:px-10 lg:px-16 pb-32 md:pb-36">
        <div className="mx-auto max-w-3xl pt-2">
          {/* ── Eyebrow + Hero cover ─────────────────────────────── */}
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="eyebrow text-[#FF8A5C]"
          >
            {t("studio.listen.eyebrow") || "LISTEN"}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.05, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="mt-3 relative overflow-hidden rounded-[26px] md:rounded-[32px] cursor-pointer select-none border border-white/40 shadow-[0_28px_70px_rgba(26,26,26,0.12)]"
            style={{
              background: version.visualConfig.gradient,
              aspectRatio: "4/3",
            }}
            onClick={onTogglePlay}
          >
            {/* Top fade for text legibility */}
            <div
              className="absolute inset-x-0 top-0 h-2/5 pointer-events-none"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 100%)",
              }}
            />
            {/* Living wave + particles, same motif as the Vibe cards.
                Idle: gentle. Playing: stronger drift + more particles. */}
            <MurmurWave
              color={pickAccentHex(version.visualConfig.gradient)}
              intensity={0.55}
              isPlaying={isPlaying}
              waveY={0.6}
              className="absolute inset-x-0 bottom-0 h-3/5 w-full pointer-events-none"
            />
            {/* Bottom fade for play disc */}
            <div
              className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
              style={{
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 100%)",
              }}
            />

            <div className="absolute left-6 top-6 right-6">
              <p className="text-[10px] uppercase tracking-[0.32em] text-white/72">
                {version.vibe}
              </p>
              <h1
                className="hero-serif mt-3 text-[34px] leading-[0.98] text-white md:text-[52px]"
                style={{ letterSpacing: "-0.018em" }}
              >
                {version.title}
              </h1>
            </div>

            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between gap-5">
              <p className="font-serif-italic max-w-[18rem] text-[13px] leading-[1.5] text-white/78 md:text-[14px]">
                {t("studio.hero.sub") ||
                  "Sit with it for a moment. Adjust the mood if you want."}
              </p>
              <motion.div
                whileTap={{ scale: 0.92 }}
                className={`flex h-14 w-14 md:h-16 md:w-16 items-center justify-center rounded-full border border-white/60 backdrop-blur-md transition-colors ${
                  isPlaying ? "bg-white/40" : "bg-white/22"
                }`}
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5 md:h-6 md:w-6 text-white" fill="white" />
                ) : (
                  <Play
                    className="ml-0.5 h-5 w-5 md:h-6 md:w-6 text-white"
                    fill="white"
                  />
                )}
              </motion.div>
            </div>
          </motion.div>

          {/* ── Meta row — eyebrow caps, tabular numeric ────────── */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.55 }}
            className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.22em] text-[#8C8780]"
          >
            <span>{version.vibe}</span>
            <span className="text-[#D2C9B6]">·</span>
            <span className="tabular-nums">{version.melody.bpm} BPM</span>
            <span className="text-[#D2C9B6]">·</span>
            <span>
              {version.melody.key} {version.melody.scale}
            </span>
            <span className="text-[#D2C9B6]">·</span>
            <span className="tabular-nums">{durLabel}</span>
          </motion.div>

          {/* ── Editorial caption ───────────────────────────────── */}
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.55 }}
            className="font-serif-italic mt-4 max-w-[28rem] text-[14px] leading-[1.55] text-[#6F6A63] md:text-[15px]"
          >
            {t("studio.listen.body") ||
              "This is what your hum became. You can save it, or tweak the mood first."}
          </motion.p>

          {/* ── Tweak link ──────────────────────────────────────── */}
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.28, duration: 0.5 }}
            onClick={onTweak}
            className="font-serif-italic mt-8 text-[18px] md:text-[20px] text-[#FF5924] hover:text-[#D9421A] transition-colors underline-mm"
          >
            {t("studio.tweak.cta") || "Tweak this song"}
            <span className="ml-1 not-italic">→</span>
          </motion.button>
        </div>
      </div>

      <BottomSave label={t("studio.save")} onClick={onSave} disabled={!canSave} />
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Plane 2 — Tweak
   ───────────────────────────────────────────────────────────────────── */

function TweakPlane({
  version,
  promptBusy,
  canUndo,
  onScene,
  onPrompt,
  onUndo,
  onRestoreAll,
  onFineTune,
  onBack,
  onSave,
  canSave,
  dimmed,
}: {
  version: VibeVersion;
  promptBusy: boolean;
  canUndo: boolean;
  onScene: (s: Scene) => void;
  onPrompt: (p: string) => void;
  onUndo: () => void;
  onRestoreAll: () => void;
  onFineTune: () => void;
  onBack: () => void;
  onSave: () => void;
  canSave: boolean;
  dimmed: boolean;
}) {
  const t = useTranslator();
  const [prompt, setPrompt] = useState("");

  const submitPrompt = () => {
    const v = prompt.trim();
    if (!v || promptBusy) return;
    setPrompt("");
    onPrompt(v);
  };

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{
        y: 0,
        scale: dimmed ? 0.96 : 1,
        opacity: dimmed ? 0.35 : 1,
        filter: dimmed ? "blur(2px)" : "blur(0px)",
      }}
      exit={{ y: "100%" }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-20 flex flex-col bg-[#F5F1EB]/96 backdrop-blur-[2px]"
      style={{ pointerEvents: dimmed ? "none" : "auto" }}
    >
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col">
        <Header
          center={
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
              {t("studio.tweak.header") || "TWEAK"} · {version.vibe}
            </p>
          }
          onBack={onBack}
          onRestore={onRestoreAll}
          restoreAria={t("studio.restore")}
        />

        <div className="flex-1 px-5 md:px-10 lg:px-16 pb-32 md:pb-36">
          <div className="mx-auto max-w-3xl">
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="eyebrow text-[#FF8A5C]"
            >
              {t("studio.tweak.eyebrow") || "TWEAK"}
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="hero-serif mt-3 text-[#1A1A1A] text-[30px] leading-[1.05] md:text-[44px]"
            >
              {t("studio.tweak.title") || "What should change?"}
            </motion.h2>

            {/* ── Auris input ─────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.55 }}
              className="mt-7 relative"
            >
              <div className="flex items-end gap-2 border-b-[1.5px] border-[#D2C9B6] focus-within:border-[#FF5924] transition-colors pb-2.5">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitPrompt();
                  }}
                  disabled={promptBusy}
                  placeholder={
                    t("studio.prompt.placeholder") ||
                    "more strings · warmer · slower …"
                  }
                  className="flex-1 min-w-0 bg-transparent text-[17px] md:text-[19px] text-[#1A1A1A] outline-none placeholder:text-[#B6B0A4] font-serif-italic"
                />
                <button
                  onClick={submitPrompt}
                  disabled={!prompt.trim() || promptBusy}
                  className="text-[13px] tracking-[0.04em] text-[#FF5924] disabled:text-[#B6B0A4] transition-colors hover:text-[#D9421A]"
                >
                  {promptBusy ? "…" : (t("studio.prompt.cta") || "Apply")}
                </button>
              </div>
              <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-[#B7AEA1]">
                AURIS · {t("studio.auris.badge") || "yours to ask"}
              </p>
            </motion.div>

            {/* ── Scene cards ─────────────────────────────────── */}
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.5 }}
              className="eyebrow mt-10 text-[#FF8A5C]"
            >
              {t("studio.scenes.eyebrow") || "SHIFT THE MOOD"}
            </motion.p>

            <div className="mt-4 grid grid-cols-2 gap-3 md:gap-4">
              {SCENES.map((scene, i) => (
                <motion.button
                  key={scene.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.22 + i * 0.05,
                    duration: 0.55,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => onScene(scene)}
                  className={`group relative isolate overflow-hidden rounded-[20px] border border-[#E7DECF] bg-[#FFFCF7] text-left transition-colors hover:border-[#FF8A5C] ${
                    i === SCENES.length - 1 && SCENES.length % 2 === 1
                      ? "col-span-2"
                      : ""
                  }`}
                  style={{ minHeight: 132 }}
                >
                  {/* Bottom-rising particle accent (one keyframe is fine) */}
                  <SceneAccent color={scene.accent} />

                  <div className="relative z-10 flex h-full flex-col justify-between p-5 md:p-6">
                    <span className="text-[10px] uppercase tracking-[0.22em] text-[#B7AEA1]">
                      Mood
                    </span>
                    <div>
                      <p className="font-serif-italic text-[20px] leading-tight text-[#1A1A1A] md:text-[24px]">
                        {t(scene.labelKey)}
                      </p>
                      <p className="mt-1 text-[11px] leading-[1.5] text-[#8C8780] md:text-[12px]">
                        {t(scene.descKey)}
                      </p>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>

            {/* ── Tertiary row: Undo / Restore / Fine-tune ────── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.5 }}
              className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3"
            >
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className="flex items-center gap-1.5 text-[12px] tracking-[0.04em] text-[#8C8780] disabled:opacity-40 hover:text-[#1A1A1A] transition-colors"
              >
                <Undo2 className="h-3.5 w-3.5" />
                {t("studio.undo") || "Undo"}
              </button>
              <button
                onClick={onRestoreAll}
                className="flex items-center gap-1.5 text-[12px] tracking-[0.04em] text-[#8C8780] hover:text-[#1A1A1A] transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("studio.restore") || "Restore"}
              </button>
              <button
                onClick={onFineTune}
                className="font-serif-italic ml-auto text-[15px] text-[#FF5924] hover:text-[#D9421A] underline-mm transition-colors"
              >
                {t("studio.finetune.cta") || "Fine-tune mix"}
                <span className="ml-1 not-italic">→</span>
              </button>
            </motion.div>
          </div>
        </div>

        <BottomSave label={t("studio.save")} onClick={onSave} disabled={!canSave} />
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Plane 3 — Balance (TrackMixer in a sheet)
   ───────────────────────────────────────────────────────────────────── */

function BalancePlane({
  arrangement,
  onTrack,
  onBack,
}: {
  arrangement: ArrangementState;
  onTrack: (key: keyof ArrangementState, patch: Partial<TrackState>) => void;
  onBack: () => void;
}) {
  const t = useTranslator();

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-30 flex flex-col bg-[#F5F1EB]/98 backdrop-blur-[3px]"
    >
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col">
        <Header
          center={
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
              <Sliders className="inline h-3 w-3 mr-1.5" />
              {t("studio.balance.header") || "FINE-TUNE"}
            </p>
          }
          onBack={onBack}
        />

        <div className="flex-1 px-5 md:px-10 lg:px-16 pb-32 md:pb-36">
          <div className="mx-auto max-w-2xl">
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="eyebrow text-[#FF8A5C]"
            >
              {t("studio.mixer.eyebrow") || "BALANCE"}
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04, duration: 0.6 }}
              className="hero-serif mt-3 text-[#1A1A1A] text-[28px] leading-[1.05] md:text-[40px]"
            >
              {t("studio.mixer.title") || "Balance the parts."}
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5 }}
              className="font-serif-italic mt-3 max-w-[28rem] text-[14px] text-[#6F6A63]"
            >
              {t("studio.mixer.body") ||
                "Each part can sit louder or quieter. Tap the chip to mute."}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, duration: 0.55 }}
              className="mt-8"
            >
              <TrackMixer arrangement={arrangement} onTrack={onTrack} />
            </motion.div>
          </div>
        </div>

        <div
          className="fixed left-0 right-0 px-5 pt-3 pb-5 md:px-8"
          style={{
            left: "var(--side-nav-w)",
            bottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <div className="mx-auto max-w-2xl">
            <button
              onClick={onBack}
              className="h-13 w-full rounded-[20px] bg-[#1A1A1A] py-3.5 text-base font-medium text-white transition-opacity hover:opacity-90"
            >
              {t("studio.balance.done") || "Done"}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Shared bits
   ───────────────────────────────────────────────────────────────────── */

function Header({
  center,
  onBack,
  onRestore,
  restoreAria,
}: {
  center: React.ReactNode;
  onBack: () => void;
  onRestore?: () => void;
  restoreAria?: string;
}) {
  return (
    <div
      className="relative z-10 flex items-center justify-between px-5 pb-5 md:px-8"
      style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
    >
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 hover:bg-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
      </button>
      <div className="text-center">{center}</div>
      {onRestore ? (
        <button
          onClick={onRestore}
          aria-label={restoreAria ?? "Restore"}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 hover:bg-white transition-colors"
        >
          <RotateCcw className="h-4 w-4 text-[#8C8780]" />
        </button>
      ) : (
        <div className="h-9 w-9" />
      )}
    </div>
  );
}

function BottomSave({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="fixed left-0 right-0 bg-gradient-to-t from-[#F5F1EB] via-[#F5F1EB] to-transparent px-5 pt-7 pb-5 md:px-8"
      style={{
        left: "var(--side-nav-w)",
        bottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="mx-auto max-w-3xl">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onClick}
          disabled={disabled}
          className="h-14 w-full rounded-[22px] bg-[#1A1A1A] text-base font-medium text-white transition-opacity disabled:opacity-45"
        >
          {label}
        </motion.button>
      </div>
    </div>
  );
}

/* ── Scene card particle accent — one named CSS keyframe per card ─────── */
function SceneAccent({ color }: { color: string }) {
  // Two layers: a soft glow at the bottom + a few floating dots. Cheap, GPU.
  return (
    <>
      <div
        className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 80% 70% at 50% 110%, ${color}33 0%, transparent 70%)`,
        }}
      />
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="scene-particle"
          style={{
            width: 4 + (i % 2),
            height: 4 + (i % 2),
            left: `${18 + i * 22}%`,
            background: color,
            // CSS var consumed by the .scene-particle @keyframes
            ["--drift" as never]: `${(i % 2 === 0 ? 1 : -1) * (4 + i)}px`,
            animationDelay: `${i * 0.6}s`,
            animationDuration: `${4.2 + i * 0.4}s`,
          } as React.CSSProperties}
        />
      ))}
    </>
  );
}
