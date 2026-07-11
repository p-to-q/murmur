"use client";

/**
 * NameScreen — Compose v2 *christen* moment.
 *
 * Specced in docs/page-redesign.md §5.
 *
 * Small fixes over v1:
 *   - eyebrow added (parity with every other v2 screen)
 *   - three serif-italic suggestion names below the input, click = populate
 *   - processing copy rotates editorially while saving (Hum-style)
 *   - bottom Save bar reads `var(--side-nav-w)` so collapsed nav follows
 *
 * Save flow unchanged: render MP3 → POST /api/songs → navigate to /song/[id].
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { memory } from "@/lib/platform/memory";
import { ensureLocalCreatorSession } from "@/lib/auth/local-creator-client";

import { formatStudioSupportCode } from "@/lib/observability/support-code";
import {
  ApiEnvelopeError,
  apiErrorEnvelopeFrom,
  readApiErrorEnvelope,
} from "@/lib/api/error-envelope";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { trackStageEntered, trackStageCompleted } from "@/lib/observability/stage-tracking";
import { addMurmurNotification } from "@/lib/store/notification-store";
import { songSavedNotificationCopy } from "@/lib/notifications/notification-copy";
import { useCurrentLang, useTranslator } from "@/lib/i18n";
import {
  buildFallbackTitleSuggestionBatch,
  buildVersionTitleSuggestionBatch,
} from "@/lib/music/title-suggestions";
import { synth } from "@/lib/music/simple-synth";
import { buildDemoFlowStateAsync } from "@/modules/demo/demo-flow";
import { renderAudio } from "@/modules/export/render-mp3";
import { canSaveHeardVersion, getSaveBlockReason } from "@/modules/music/version-contract";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { buildNameSaveMetadata, buildSaveProvenance } from "./name-save-metadata";
import {
  getInitialNameTitleState,
  resolveNameDisplayTitle,
  type NameTitleMode,
} from "./name-title";
import { useRestoredVersionAudio } from "./use-restored-version-audio";

const PROCESSING_INTERVAL_MS = 900;

export function NameScreen({ initialDemo = false }: { initialDemo?: boolean }) {
  const router = useRouter();
  const t = useTranslator();
  const lang = useCurrentLang();
  const currentVersion = useMurmurStore((s) => s.currentVersion);
  const setCurrentVersion = useMurmurStore((s) => s.setCurrentVersion);
  const setVibeVersions = useMurmurStore((s) => s.setVibeVersions);
  const setCurrentDraftId = useMurmurStore((s) => s.setCurrentDraftId);
  const setCurrentFlowId = useMurmurStore((s) => s.setCurrentFlowId);
  const setActiveCreationRoute = useMurmurStore((s) => s.setActiveCreationRoute);
  const restoredDraftAt = useMurmurStore((s) => s.restoredDraftAt);
  const resetFlow = useMurmurStore((s) => s.resetFlow);
  const demoSeededRef = useRef(false);
  const demoEnabled = initialDemo;

  const [title, setTitle] = useState("");
  const [titleMode, setTitleMode] = useState<NameTitleMode>("suggested");
  const [titleVersionId, setTitleVersionId] = useState<string | null>(null);
  const [suggestionBatch, setSuggestionBatch] = useState({ key: "", index: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [processingIdx, setProcessingIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentVersionId = currentVersion?.id ?? null;

  useEffect(() => {
    if (currentVersion) {
      setActiveCreationRoute("/studio/name");
    }
  }, [currentVersion, setActiveCreationRoute]);

  // Track once per mount, but only after a version exists — demo seeding fills
  // the store asynchronously, and firing earlier would drop the flow context.
  const stageTrackedRef = useRef(false);
  useEffect(() => {
    if (stageTrackedRef.current || !currentVersion) return;
    stageTrackedRef.current = true;
    trackStageEntered(currentVersion.originFlowId, "save", {
      draftId: currentVersion.draftId,
    });
  }, [currentVersion]);

  useRestoredVersionAudio(currentVersion, restoredDraftAt);

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

  /* ── Suggestions ──────────────────────────────────────────────── */
  const suggestionKey = `${currentVersion?.id ?? "fallback"}:${lang}`;
  const suggestionBatchIndex =
    suggestionBatch.key === suggestionKey ? suggestionBatch.index : 0;
  const suggestions = useMemo(() => {
    if (!currentVersion) return buildFallbackTitleSuggestionBatch(lang, suggestionBatchIndex);
    return buildVersionTitleSuggestionBatch(currentVersion, lang, suggestionBatchIndex);
  }, [currentVersion, lang, suggestionBatchIndex]);
  const initialTitleState = useMemo(
    () => getInitialNameTitleState(currentVersion?.title, suggestions),
    [currentVersion?.title, suggestions],
  );
  const activeTitleState =
    titleVersionId === currentVersionId
      ? { title, titleMode }
      : initialTitleState;
  const displayTitle =
    resolveNameDisplayTitle(activeTitleState, suggestions);

  /* ── Rotating processing copy ─────────────────────────────────── */
  const PROCESSING_COPY = useMemo(
    () => [
      t("name.proc.rendering") || "rendering",
      t("name.proc.polishing") || "polishing",
      t("name.proc.encoding")  || "encoding",
      t("name.proc.almost")    || "almost there",
    ],
    [t],
  );

  useEffect(() => {
    if (!currentVersionId) return;
    synth.stop();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [currentVersionId]);

  useEffect(() => {
    if (!isSaving) return;
    const id = window.setInterval(() => {
      setProcessingIdx((i) => (i + 1) % PROCESSING_COPY.length);
    }, PROCESSING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isSaving, PROCESSING_COPY.length]);

  if (!currentVersion) {
    if (demoEnabled) {
      return (
        <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
          <PageBackdrop />
          <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
            <p className="text-base text-[#8C8780]">{t("hum.proc.polishing")}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
        <PageBackdrop />
        <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
          <h1 className="hero-serif text-[28px] text-[#1A1A1A] md:text-[40px]">
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

  const handleSave = async () => {
    const trimmed = displayTitle.trim();
    if (!trimmed) {
      toast(t("name.required"));
      inputRef.current?.focus();
      return;
    }
    if (isSaving) return;
    const saveBlockReason = getSaveBlockReason(currentVersion);
    if (!canSaveHeardVersion(currentVersion)) {
      toast(
        saveBlockReason === "generation_failed"
          ? (t("studio.magenta.save_failed") || "This take did not finish rendering. Brew it again before saving.")
          : (t("studio.magenta.save_pending") || "Let this take finish rendering before saving."),
      );
      router.push("/studio");
      return;
    }

    setIsSaving(true);
    setProcessingIdx(0);

    const id = currentVersion.draftId;
    let mp3DataUrl: string | undefined;
    let renderedDurationSec: number | undefined;

    const versionWithName = { ...currentVersion, title: trimmed };
    const saveMetadata = buildNameSaveMetadata(versionWithName);

    try {
      const rendered = await renderAudio(versionWithName);
      if (rendered) {
        mp3DataUrl = rendered.dataUrl;
        renderedDurationSec = rendered.durationSec;
      }
    } catch (error) {
      console.warn("[Name] render failed, saving without audio:", error);
    }

    try {
      const hasCreatorSession = await ensureLocalCreatorSession();
      if (!hasCreatorSession) {
        console.warn("[Name] Local Creator session unavailable; trying local preview save fallback.");
      }
      const response = await fetch("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          userId: "guest",
          title: trimmed,
          vibe: saveMetadata.vibe,
          vibeEn: saveMetadata.vibeEn,
          bpm: versionWithName.melody.bpm,
          keySignature: versionWithName.melody.key.split(" ")[0] ?? "C",
          scaleType: versionWithName.melody.scale,
          duration: Math.round(renderedDurationSec ?? versionWithName.melody.duration),
          parentSongId: versionWithName.parentSongId,
          rootSongId: versionWithName.rootSongId,
          lineageDepth: versionWithName.lineageDepth,
          sourceMelodyKind: versionWithName.sourceMelodyKind,
          editCount: versionWithName.editCount,
          editDepth: versionWithName.editDepth,
          mp3DataUrl,
          // Canonical editable source + provenance, persisted separately from
          // the playback artifact (#297).
          melody: versionWithName.melody,
          provenance: buildSaveProvenance(versionWithName),
          visualConfig: versionWithName.visualConfig,
          arrangementState: versionWithName.arrangementState,
          tags: versionWithName.tags,
        }),
      });
      if (!response.ok) {
        throw new ApiEnvelopeError(await readApiErrorEnvelope(response, "save_failed"));
      }
      const savedSong = await response.json().catch(() => null) as { id?: unknown } | null;
      const savedSongId = typeof savedSong?.id === "string" ? savedSong.id : id;

      memory
        .reportAction({
          content: `Saved "${trimmed}" (audio: ${mp3DataUrl ? "yes" : "no"})`,
          event_type: "create",
          page: "studio.name",
          metadata: {
            type: "save_song",
            song_id: id,
            has_audio: !!mp3DataUrl,
            parent_song_id: versionWithName.parentSongId,
            root_song_id: versionWithName.rootSongId,
            lineage_depth: versionWithName.lineageDepth,
            source_melody_kind: versionWithName.sourceMelodyKind,
            edit_depth: versionWithName.editDepth,
            edit_count: versionWithName.editCount,
          },
        })
        .catch(() => {});

      const savedTitle = displayTitle.trim();
      const savedCopy = songSavedNotificationCopy(lang, savedTitle);
      addMurmurNotification({
        kind: "song_saved",
        title: savedCopy.title,
        body: savedCopy.body,
        href: `/song/${savedSongId}`,
        sourceId: savedSongId,
        meta: { songTitle: savedTitle },
      });

      trackStageCompleted(currentVersion.originFlowId, "save", {
        songId: savedSongId,
      });
      toast.success(t("studio.save_ok"));
      resetFlow();
      router.push(`/song/${savedSongId}`);
    } catch (error) {
      console.error("[Name] save failed:", error);
      const envelope = apiErrorEnvelopeFrom(error);
      toast.error(t("studio.save_err"), {
        description: formatStudioSupportCode({
          code: envelope?.code ?? "save_failed",
          requestId: envelope?.requestId ?? null,
        }),
      });
      setIsSaving(false);
    }
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop />

      <div className="relative z-10 flex min-h-svh flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pb-5 md:px-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
        >
          <button
            onClick={() => router.back()}
            aria-label={t("name.cancel")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 hover:bg-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
          </button>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
            {currentVersion.vibe} · {currentVersion.melody.bpm} BPM
          </p>
          <div className="h-9 w-9" />
        </div>

        {/* Body — bottom-third weighted so the input feels intentional */}
        <div className="flex flex-1 flex-col justify-end px-6 pb-44 md:px-8">
          <div className="mx-auto w-full max-w-[560px]">
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
              className="eyebrow text-[#FF8A5C]"
            >
              {t("name.eyebrow") || "NAME IT"}
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="hero-serif mt-3 text-[#1A1A1A] text-[40px] leading-[1.02] md:text-[60px]"
            >
              {t("name.title") || "What do you call this little song?"}
            </motion.h1>

            <motion.input
              ref={inputRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.18, duration: 0.5 }}
              type="text"
              value={displayTitle}
              onChange={(e) => {
                setTitleVersionId(currentVersionId);
                setTitleMode("custom");
                setTitle(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
              placeholder={t("name.placeholder") || "Say it the way you'd remember it…"}
              maxLength={80}
              disabled={isSaving}
              className="mt-9 w-full border-0 border-b-[1.5px] border-[#D2C9B6] bg-transparent pb-3 font-serif-italic text-[34px] leading-[1.1] text-[#1A1A1A] outline-none transition-colors placeholder:text-[#BFB6A8] focus:border-[#FF5924] md:text-[44px] disabled:opacity-60"
            />

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[#B7AEA1] tabular-nums">
                {displayTitle.length}/80
              </p>
            </div>

            {/* Suggestions row */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.5 }}
              className="mt-7"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[#B7AEA1]">
                  {t("name.suggestions") || "Try"}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setSuggestionBatch({
                      key: suggestionKey,
                      index: suggestionBatchIndex + 1,
                    })
                  }
                  disabled={isSaving}
                  aria-label={t("name.refresh_suggestions") || "Refresh suggestions"}
                  title={t("name.refresh_suggestions") || "Refresh suggestions"}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[#E3DACA] bg-white/55 text-[#8C8780] transition-colors hover:border-[#FFB199] hover:text-[#FF5924] disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {suggestions.map((s, i) => (
                  <span key={s} className="inline-flex items-baseline gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setTitleVersionId(currentVersionId);
                        setTitleMode("suggested");
                        setTitle(s);
                        inputRef.current?.focus();
                      }}
                      disabled={isSaving}
                      className="font-serif-italic text-[16px] text-[#8C8780] hover:text-[#B83212] underline-mm transition-colors disabled:opacity-50"
                    >
                      {s}
                    </button>
                    {i < suggestions.length - 1 && (
                      <span className="text-[#D2C9B6]">·</span>
                    )}
                  </span>
                ))}
              </div>
            </motion.div>
          </div>
        </div>

        {/* Bottom Save bar */}
        <div
          className="fixed left-0 right-0 bg-gradient-to-t from-[#F5F1EB] via-[#F5F1EB] to-transparent px-5 pt-7 pb-5 md:px-8"
          style={{
            left: "var(--side-nav-w)",
            bottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <div className="mx-auto max-w-[560px]">
            {/* Rotating processing copy slot */}
            <div className="mb-2 h-4 text-center">
              <AnimatePresence mode="wait">
                {isSaving && (
                  <motion.p
                    key={`proc-${processingIdx}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.28 }}
                    className="font-serif-italic text-[12px] text-[#8C8780]"
                  >
                    {PROCESSING_COPY[processingIdx]}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => void handleSave()}
              disabled={isSaving || !displayTitle.trim() || !canSaveHeardVersion(currentVersion)}
              className="h-14 w-full rounded-[22px] bg-[#1A1A1A] text-base font-medium text-white transition-opacity disabled:opacity-45"
            >
              {isSaving
                ? t("studio.saving") || "Saving…"
                : t("name.save") || "Save"}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
