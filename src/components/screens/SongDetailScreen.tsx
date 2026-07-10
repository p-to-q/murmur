"use client";

/**
 * SongDetailScreen — Compose v2 *possess* moment.
 *
 * Specced in docs/page-redesign.md §6 + docs/page-contracts.md §6.
 *
 * Treats the saved song as a record sleeve: cover (reactive canvas) +
 * editorial meta + an export menu rendered as named affordances, NOT
 * a colored button grid.
 *
 * Removed from v1:
 *   - The "Live preview" status card (engineering exposure).
 *   - The arrangement track-list block (debug shape).
 *   - The Sliders icon as the primary entry to Studio.
 *
 * Playback contract (also see docs/audio-pipeline-redesign.md §6.7):
 *   - Prefer the rendered MP3 if present.
 *   - Otherwise fall back to a synth replay. v1's fallback split the
 *     melody.currentPattern string and lost rhythm; v2 should read the
 *     persisted CleanMelody from `song.melody` once that column lands
 *     (data-model.md §3.6 v2-0006). Until then, the Tone replay degrades
 *     gracefully — but the dominant UX is mp3 playback.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Copy, MoreHorizontal, Pause, Play } from "lucide-react";
import { toast } from "sonner";

import { memory } from "@/lib/platform/memory";
import { ensureLocalCreatorSession } from "@/lib/auth/local-creator-client";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/dict";
import { getPlayer, startAudioContext } from "@/lib/music/tone-player";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";
import { SongVisualCanvas } from "@/components/song-detail/song-visual-canvas";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { Spinner } from "@/components/ui/spinner";
import { ShareTicketCard } from "@/components/song-detail/ShareTicketCard";
import { exportSongAsVideo } from "@/modules/export/export-video";
import {
  buildSavedSongEditDraft,
  buildSavedSongRemixVersions,
} from "@/modules/music/saved-song-version";
import { buildLineageTrail } from "@/modules/music/lineage";
import { getMelodyOriginCopy } from "@/modules/music/melody-origin";
import { displayVibeLabel } from "@/lib/music/display-vibe";
import { copyTextToClipboard } from "@/lib/platform/clipboard";
import {
  createSongShareLink,
  SongShareRequestError,
  type SongShareRequestErrorCode,
} from "@/lib/api/song-share";
import { hasSongShareAudio } from "@/lib/share/song-share";
import { formatShareSupportCode, formatSupportCode } from "@/lib/observability/support-code";
import {
  ApiEnvelopeError,
  apiErrorEnvelopeFrom,
  readApiErrorEnvelope,
} from "@/lib/api/error-envelope";
import type { SongCard } from "@/modules/shared/types";

type Song = SongCard & {
  mp3DataUrl?: string | null;
  mp3Url?: string | null;
  bpm?: number;
  keySignature?: string;
  tags?: string[];
  visibility?: "private" | "unlisted" | "public";
  shareCode?: string | null;
};

// Lineage trail cards only render id/title/vibe/tags, so related songs are
// fetched as summaries (?view=summary) — never their audio or arrangement.
type RelatedSong = Pick<Song, "id" | "title" | "vibe" | "tags">;

type ExportKey = "audio" | "video" | "share" | "link";
type ShareCardMode = "image" | "video";
const CJK_TEXT_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

export function SongDetailScreen({ songId }: { songId: string }) {
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const setCurrentVersion = useMurmurStore((state) => state.setCurrentVersion);
  const setVibeVersions = useMurmurStore((state) => state.setVibeVersions);
  const setCurrentDraftId = useMurmurStore((state) => state.setCurrentDraftId);
  const setCurrentFlowId = useMurmurStore((state) => state.setCurrentFlowId);

  const [song, setSong] = useState<Song | null>(null);
  const [parentSong, setParentSong] = useState<RelatedSong | null>(null);
  const [rootSong, setRootSong] = useState<RelatedSong | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<ExportKey | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareCardOpen, setShareCardOpen] = useState(false);
  const [shareCardMode, setShareCardMode] = useState<ShareCardMode>("image");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* ── Load ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await ensureLocalCreatorSession();
        const res = await fetch(`/api/songs/${songId}`);
        if (!res.ok) {
          if (active) setSong(null);
          return;
        }
        const data = (await res.json()) as Song;
        if (!active) return;
        setSong(data);
        memory
          .reportAction({
            content: `Song detail open: "${data.title}"`,
            event_type: "navigate",
            page: "song-detail",
            metadata: { type: "song_open", song_id: data.id },
          })
          .catch(() => {});
      } catch (err) {
        console.warn("[SongDetail] load error:", err);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [songId]);

  /* ── Cleanup ───────────────────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      getPlayer().stop().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!song) return;

    const parentId =
      typeof song.parentSongId === "string" && song.parentSongId !== song.id
        ? song.parentSongId
        : null;
    const rootId =
      typeof song.rootSongId === "string" && song.rootSongId !== song.id
        ? song.rootSongId
        : null;

    if (!parentId && !rootId) {
      return;
    }

    let active = true;
    const load = async () => {
      const entries = await Promise.all([
        fetchRelatedSong(parentId),
        fetchRelatedSong(rootId),
      ]);
      if (!active) return;
      setParentSong(entries[0]);
      setRootSong(entries[1]);
    };

    void load();

    return () => {
      active = false;
    };
  }, [song]);

  /* ── Playback (mp3 first; tone fallback) ──────────────────────────── */
  const playWithTone = useCallback(async () => {
    if (!song) return;
    const player = getPlayer();
    if (isPlaying) {
      await player.stop();
      setIsPlaying(false);
      return;
    }
    try {
      setIsPlaying(true);
      const pitches = song.arrangementState.melody.currentPattern
        .split(" ")
        .map(Number)
        .filter((p) => !Number.isNaN(p) && p > 20 && p < 120);
      const melodyNotes = pitches.map((pitch, i) => ({
        pitch,
        start: i * 0.5,
        duration: 0.45,
        velocity: 0.65,
        confidence: 0.9,
      }));
      const chords = song.arrangementState.chords.currentPattern
        .split(" ")
        .filter(Boolean);
      const bpm = song.bpm ?? 80;
      await player.play(melodyNotes, song.arrangementState, chords, bpm);
    } catch (err) {
      console.error("[SongDetail] tone play error:", err);
      toast.error(t("song.export.err"), {
        description: formatSupportCode({ area: "SONG", error: "playback_failed", requestId: null }),
      });
      setIsPlaying(false);
    }
  }, [song, isPlaying, t]);

  const handlePlay = useCallback(async () => {
    if (!song) return;
    const audioSrc = song.mp3DataUrl || song.mp3Url;
    if (audioSrc) {
      let el = audioRef.current;
      if (!el) {
        el = new Audio(audioSrc);
        el.preload = "auto";
        el.addEventListener("ended", () => setIsPlaying(false));
        el.addEventListener("pause", () => setIsPlaying(false));
        el.addEventListener("play", () => setIsPlaying(true));
        audioRef.current = el;
      }
      if (el.paused) {
        try {
          await el.play();
        } catch (err) {
          console.warn("[SongDetail] audio play denied:", err);
          await playWithTone();
        }
      } else {
        el.pause();
      }
      return;
    }
    await playWithTone();
  }, [song, playWithTone]);

  /* ── Exports — same modules as v1; presented differently ──────────── */

  const gradient = useMemo(() => {
    if (!song) return "linear-gradient(135deg, #FF8A5C, #FF5924)";
    return (
      (song.visualConfig as { posterBg?: string }).posterBg ??
      song.visualConfig.gradient ??
      "linear-gradient(135deg, #FF8A5C, #FF5924)"
    );
  }, [song]);

  const slug = useMemo(
    () => (song?.title ?? "murmur").replace(/\s+/g, "-").toLowerCase(),
    [song],
  );

  const exportAudio = async () => {
    const audioSrc = song?.mp3DataUrl || song?.mp3Url;
    if (!audioSrc) {
      toast(t("song.share.no_audio"));
      return;
    }
    setBusy("audio");
    try {
      const ext = audioSrc.startsWith("data:audio/wav") ? "wav" : "mp3";
      const a = document.createElement("a");
      a.href = audioSrc;
      a.download = `${slug}.${ext}`;
      a.click();
      toast.success(t("song.export.ok"));
      memory
        .reportAction({
          content: `Exported audio for "${song.title}"`,
          event_type: "update",
          page: "song-detail",
          metadata: { type: "download_audio", song_id: song.id, format: ext },
        })
        .catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const exportVideo = useCallback(async () => {
    if (!song) return;
    setBusy("video");
    try {
      await exportSongAsVideo(song);
      toast.success(t("song.export.ok"));
      memory
        .reportAction({
          content: `Exported video for "${song.title}"`,
          event_type: "update",
          page: "song-detail",
          metadata: { type: "download_video", song_id: song.id },
        })
        .catch(() => {});
    } catch (e) {
      console.error(e);
      toast.error(t("song.export.err"), {
        description: formatShareSupportCode({ code: "export_failed", requestId: null }),
      });
    } finally {
      setBusy(null);
    }
  }, [song, t]);

  const copyShareLink = useCallback(async () => {
    if (!song) return;
    if (!hasSongShareAudio(song)) {
      toast(t("song.share.no_audio"));
      return;
    }
    setBusy("link");
    try {
      const share = await createSongShareLink({
        songId: song.id,
        visibility: "unlisted",
      });

      const copied = await copyTextToClipboard(share.url);
      setSong((current) =>
        current && current.id === song.id
          ? {
              ...current,
              shareCode: share.shareCode,
              visibility: share.visibility,
            }
          : current,
      );
      if (!copied) {
        window.open(share.url, "_blank", "noopener,noreferrer");
        throw new SongShareRequestError({
          code: "clipboard_unavailable",
          status: 0,
          message: "Clipboard unavailable",
          requestId: share.requestId,
        });
      }
      toast.success(t("song.share.link_copied") || "Share link copied");
      memory
        .reportAction({
          content: `Copied share link for "${song.title}"`,
          event_type: "update",
          page: "song-detail",
          metadata: { type: "copy_song_share_link", song_id: song.id },
        })
        .catch(() => {});
    } catch (error) {
      console.error(error);
      const code =
        error instanceof SongShareRequestError
          ? error.code
          : "server_error";
      const reqId = error instanceof SongShareRequestError ? error.requestId : null;
      toast.error(shareLinkErrorMessage(code, t), {
        description: formatShareSupportCode({ code, requestId: reqId }),
      });
    } finally {
      setBusy(null);
    }
  }, [song, t]);

  /* ── Delete ────────────────────────────────────────────────────────── */

  const handleDelete = async () => {
    if (!song) return;
    try {
      const res = await fetch(`/api/songs/${song.id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new ApiEnvelopeError(await readApiErrorEnvelope(res, "delete_failed"));
      }
      memory
        .reportAction({
          content: `Deleted "${song.title}"`,
          event_type: "delete",
          page: "song-detail",
          metadata: { type: "song_delete", song_id: song.id },
        })
        .catch(() => {});
      router.push("/gallery");
    } catch (e) {
      console.error(e);
      const envelope = apiErrorEnvelopeFrom(e);
      toast.error(t("song.delete.failed") || "Couldn't delete that one. Try again?", {
        description: formatSupportCode({
          area: "SONG",
          error: envelope?.code ?? "delete_failed",
          requestId: envelope?.requestId ?? null,
        }),
      });
    }
  };

  /* ── Render guards ────────────────────────────────────────────────── */

  if (isLoading) {
    return <GlobalLoadingIndicator />;
  }

  if (!song) {
    return (
      <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
        <PageBackdrop />
        <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
          <p className="eyebrow mb-3 text-[#FF8A5C]">{t("song.not_found.eyebrow") || "EMPTY"}</p>
          <h1 className="hero-serif text-[#1A1A1A] text-[28px] md:text-[40px]">
            {t("song.not_found")}
          </h1>
          <button
            onClick={() => router.push("/gallery")}
            className="mm-btn-primary mt-8"
          >
            {t("song.back_to_gallery")}
          </button>
        </div>
      </div>
    );
  }

  const createdAt = new Date(song.createdAt);
  const dateLabel = createdAt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const longDateLabel = createdAt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const durSec = Math.round(song.duration);
  const durLabel = `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, "0")}`;
  const melodyOrigin = getMelodyOriginCopy(song.sourceMelodyKind, t);
  const effectiveParentSong = parentSong?.id === song.parentSongId ? parentSong : null;
  const effectiveRootSong =
    rootSong?.id === song.rootSongId && rootSong?.id !== song.id
      ? rootSong
      : null;
  const titleFontClass = titleSerifClass(song.title, {
    latin: "hero-serif-latin-italic",
    cjk: "hero-serif-italic",
  });
  const audioSrc = song.mp3DataUrl || song.mp3Url;
  const audioReady = hasSongShareAudio(song);

  const handleEditAgain = () => {
    const version = buildSavedSongEditDraft(song);
    setCurrentVersion(version);
    setCurrentDraftId(version.draftId);
    setCurrentFlowId(version.originFlowId);
    memory
      .reportAction({
        content: `Reopened "${song.title}" in studio`,
        event_type: "update",
        page: "song-detail",
        metadata: {
          type: "song_reopen",
          song_id: song.id,
          source_melody_kind: version.sourceMelodyKind,
        },
      })
      .catch(() => {});
    router.push("/studio");
  };

  const handleRemixAgain = () => {
    void buildSavedSongRemixVersions(song).then((versions) => {
      // Magenta is the only engine — an empty batch means the worker is
      // unreachable. Keep the user on the song rather than pushing an empty
      // /vibe, and tell them to retry.
      if (versions.length === 0) {
        toast(t("vibe.gen.engine_warming") || "Music engine is warming up — try again in a moment.");
        return;
      }
      const firstVersion = versions[0]!;
      setVibeVersions(versions);
      setCurrentDraftId(firstVersion.draftId);
      setCurrentFlowId(firstVersion.originFlowId);
      setCurrentVersion(null);
      memory
        .reportAction({
          content: `Remixed "${song.title}" into fresh vibe choices`,
          event_type: "navigate",
          page: "song-detail",
          metadata: {
            type: "song_remix",
            song_id: song.id,
            source_melody_kind: song.sourceMelodyKind ?? "corrected",
          },
        })
        .catch(() => {});
      router.push("/vibe");
    });
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 pb-5 md:px-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
        >
          <button
            onClick={() => router.back()}
            aria-label={t("common.back") || "Back"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 hover:bg-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
          </button>
          <div />
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t("song.menu") || "More"}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 hover:bg-white transition-colors"
            >
              <MoreHorizontal className="h-4 w-4 text-[#8C8780]" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ duration: 0.18 }}
                  className="absolute right-0 top-12 z-20 w-48 rounded-2xl border border-[#E5DDD0] bg-[#FFFEFB] py-2 shadow-[0_18px_44px_rgba(26,26,26,0.10)]"
                >
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      handleRemixAgain();
                    }}
                  >
                    {t("song.remix_again") || "Try new versions"}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      handleEditAgain();
                    }}
                  >
                    {t("song.edit_again") || "Edit again"}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      setDeleteOpen(true);
                    }}
                    danger
                  >
                    {t("song.delete") || "Delete"}
                  </MenuItem>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────── */}
        <div className="flex-1 px-5 md:px-10 lg:px-16 pb-16">
          <div className="mx-auto max-w-2xl">
            {/* Cover */}
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative overflow-hidden rounded-[26px] md:rounded-[32px] cursor-pointer select-none border border-white/40 shadow-[0_28px_70px_rgba(26,26,26,0.12)]"
              style={{ aspectRatio: "4/3" }}
              onClick={() => {
                startAudioContext();
                handlePlay();
              }}
            >
              <SongVisualCanvas gradient={gradient} artwork={song.visualConfig.artwork} />
              <div
                className="absolute inset-x-0 top-0 h-2/5 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0) 100%)",
                }}
              />
              <div
                className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 100%)",
                }}
              />

              <div className="absolute left-6 top-6 right-6">
                <p className="font-ui-label text-white/72">
                  {displayVibeLabel(song.vibe, song.tags, lang)}
                </p>
                <h1
                  className={`${titleFontClass} mt-3 text-[34px] leading-[0.98] text-white md:text-[52px]`}
                  style={{ letterSpacing: "-0.018em" }}
                >
                  {song.title}
                </h1>
              </div>

              <div className="absolute bottom-6 right-6">
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

            {/* Meta row */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.55 }}
              className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[#8C8780]"
            >
              <span className="font-ui-label tabular-nums">{song.bpm ?? 80} BPM</span>
              <span className="text-[#D2C9B6]">·</span>
              <span className="font-ui-label">{song.keySignature ?? "C"}</span>
              <span className="text-[#D2C9B6]">·</span>
              <span className="font-ui-label tabular-nums">{durLabel}</span>
              <span className="text-[#D2C9B6]">·</span>
              <span className="font-ui-label">{dateLabel}</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.13, duration: 0.55 }}
              className="mt-4 rounded-[20px] border border-[#E5DDD0] bg-[#FFFEFB]/80 px-4 py-3"
            >
              <p className="font-ui-label text-[#B7AEA1]">
                {t("song.melody_origin.eyebrow") || "MELODY SHAPE"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="font-ui-label rounded-full bg-[#F3E7D9] px-3 py-1 text-[#A56A3A]">
                  {melodyOrigin.label}
                </span>
                <p className="font-serif-italic text-[14px] leading-[1.45] text-[#6F6A63]">
                  {melodyOrigin.detailBody}
                </p>
              </div>
            </motion.div>

            {/* Editorial caption */}
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.55 }}
              className="font-serif-italic mt-3 text-[14px] leading-[1.55] text-[#6F6A63] md:text-[15px]"
            >
              {(t("song.caption") || "Made by humming, {date}.").replace(
                "{date}",
                longDateLabel,
              )}
            </motion.p>

            <SourceTracePanel
              song={song}
              melodyOrigin={melodyOrigin}
              t={t}
            />

            <LineagePanel
              song={song}
              parentSong={effectiveParentSong}
              rootSong={effectiveRootSong}
              t={t}
              lang={lang}
              onOpenSong={(id) => router.push(`/song/${id}`)}
            />

            {/* Export list */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.24, duration: 0.5 }}
              className="eyebrow font-ui-label mt-12 text-[#FF8A5C]"
            >
              {t("song.export.eyebrow") || "EXPORT"}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.55 }}
              className="mt-3 divide-y divide-[#E5DDD0] border-t border-b border-[#E5DDD0]"
            >
              <ExportRow
                label={t("song.share.link.label") || "Share link"}
                hint={t("song.share.link.hint") || "Anyone with the link can listen"}
                cost={t("song.export.free") || "free"}
                disabled={!audioReady}
                disabledHint={t("song.export.no_audio_yet") || "not yet rendered"}
                busy={busy === "link"}
                icon={<Copy className="h-4 w-4" />}
                onClick={copyShareLink}
              />
              <ExportRow
                label={t("song.export.audio.label") || "Audio"}
                hint={t("song.export.audio.hint") || "mp3"}
                cost={t("song.export.free") || "free"}
                disabled={!audioReady}
                disabledHint={t("song.export.no_audio_yet") || "not yet rendered"}
                busy={busy === "audio"}
                onClick={exportAudio}
              />
              <ExportRow
                label={t("song.export.image.label") || "Share image"}
                hint={t("song.export.image.hint") || "png"}
                cost={t("song.export.free") || "free"}
                busy={busy === "share"}
                onClick={() => {
                  setShareCardMode("image");
                  setShareCardOpen(true);
                }}
              />
              <ExportRow
                label={t("song.export.video.label") || "Video"}
                hint={t("song.export.video.hint") || "mp4"}
                cost={t("song.export.free") || "free"}
                disabled={!audioReady}
                disabledHint={t("song.export.no_audio_yet") || "not yet rendered"}
                busy={busy === "video"}
                onClick={() => {
                  setShareCardMode("video");
                  setShareCardOpen(true);
                }}
              />
            </motion.div>

            {/* Tertiary footer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2"
            >
              <button
                onClick={handleRemixAgain}
                className="font-serif-italic text-[15px] text-[#1A1A1A] hover:text-[#FF5924] underline-mm transition-colors"
              >
                {t("song.remix_again") || "Try new versions"}
              </button>
              <button
                onClick={handleEditAgain}
                className="font-serif-italic text-[15px] text-[#FF5924] hover:text-[#D9421A] underline-mm transition-colors"
              >
                {t("song.edit_again") || "Edit again"}
              </button>
              <button
                onClick={() => router.push("/gallery")}
                className="text-[12px] tracking-[0.04em] text-[#8C8780] hover:text-[#1A1A1A] transition-colors"
              >
                {t("song.back_to_gallery") || "Back to gallery"}
              </button>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Share ticket card */}
      <ShareTicketCard
        title={song.title}
        gradient={gradient}
        artwork={song.visualConfig.artwork}
        durationSec={song.duration}
        bpm={song.bpm ?? 80}
        keySignature={song.keySignature ?? "C"}
        createdAt={song.createdAt}
        audioSrc={audioSrc}
        open={shareCardOpen}
        onClose={() => setShareCardOpen(false)}
        mode={shareCardMode}
        onImageDownloaded={() => {
          toast.success(t("song.export.ok"));
          memory
            .reportAction({
              content: `Exported share image for "${song.title}"`,
              event_type: "update",
              page: "song-detail",
              metadata: { type: "download_share_image", song_id: song.id },
            })
            .catch(() => {});
        }}
        onImageDownloadError={(error) => {
          console.error(error);
          toast.error(t("song.export.err"), {
            description: formatShareSupportCode({ code: "export_failed", requestId: null }),
          });
        }}
        onDownloadVideo={exportVideo}
        videoExporting={busy === "video"}
      />

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-md px-5"
            onClick={() => setDeleteOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="mm-card w-full max-w-sm px-6 py-7 text-center"
            >
              <p className="eyebrow font-ui-label text-[#FF8A5C] mb-3">{t("song.delete.eyebrow") || "REMOVE"}</p>
              <h3 className="font-serif text-[24px] text-[#1A1A1A] leading-tight">
                {t("song.delete.title") || "Delete this little song?"}
              </h3>
              <p className="mt-2 text-[13px] text-[#8C8780] leading-relaxed">
                {t("song.delete.body") ||
                  "It will be gone from your gallery. You can hum it again later."}
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setDeleteOpen(false)}
                  className="flex-1 h-11 rounded-[18px] border border-[#E5DDD0] text-[#1A1A1A] text-[14px] hover:bg-white transition-colors"
                >
                  {t("common.cancel") || "Keep"}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 h-11 rounded-[18px] bg-[#1A1A1A] text-white text-[14px] hover:bg-[#3A3A3A] transition-colors"
                >
                  {t("song.delete.confirm") || "Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

async function fetchRelatedSong(songId: string | null): Promise<RelatedSong | null> {
  if (!songId) return null;
  try {
    const response = await fetch(`/api/songs/${songId}?view=summary`);
    if (!response.ok) return null;
    return await response.json() as RelatedSong;
  } catch {
    return null;
  }
}

/* ── Sub-components ───────────────────────────────────────────────── */

function titleSerifClass(
  text: string,
  classes: { latin: string; cjk: string },
) {
  return CJK_TEXT_RE.test(text) ? classes.cjk : classes.latin;
}

function ExportRow({
  label,
  hint,
  cost,
  disabled,
  disabledHint,
  busy,
  icon,
  onClick,
}: {
  label: string;
  hint: string;
  cost: string;
  disabled?: boolean;
  disabledHint?: string;
  busy: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={!disabled ? { x: 2 } : undefined}
      whileTap={!disabled ? { scale: 0.99 } : undefined}
      onClick={onClick}
      disabled={disabled || busy}
      className={`group flex w-full items-center justify-between gap-4 px-1 py-4 text-left transition-colors ${
        disabled ? "opacity-45" : "hover:bg-[#FFFEFB]/60"
      }`}
    >
      <div className="min-w-0">
        <p className="font-serif-italic text-[18px] text-[#1A1A1A] leading-tight md:text-[20px]">
          {label}
        </p>
        <p className="mt-1 text-[11px] tracking-[0.04em] text-[#8C8780]">
          {disabled && disabledHint ? disabledHint : hint}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-ui-label text-[#B6B0A4]">
          {cost}
        </span>
        {busy ? (
          <Spinner size="xs" variant="ink" />
        ) : icon ? (
          <span className="text-[#1A1A1A] transition-transform group-hover:translate-x-0.5">
            {icon}
          </span>
        ) : (
          <span
            className="text-[#1A1A1A] text-[18px] transition-transform group-hover:translate-x-0.5"
            aria-hidden
          >
            →
          </span>
        )}
      </div>
    </motion.button>
  );
}

function LineagePanel({
  song,
  parentSong,
  rootSong,
  t,
  lang,
  onOpenSong,
}: {
  song: Song;
  parentSong: RelatedSong | null;
  rootSong: RelatedSong | null;
  t: (key: string) => string;
  lang: Lang;
  onOpenSong: (id: string) => void;
}) {
  const hasBranchContext =
    song.lineageDepth && song.lineageDepth > 0
      ? true
      : !!song.parentSongId || !!song.rootSongId;
  const trail = buildLineageTrail(song, {
    parentSong,
    rootSong,
  });

  if (!hasBranchContext) {
    return (
      <motion.details
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.21, duration: 0.55 }}
        className="mt-6 rounded-[20px] border border-[#E5DDD0] bg-white/78 px-4 py-4"
      >
        <summary className="cursor-pointer list-none font-ui-label text-[#B7AEA1]">
          {t("song.lineage.reveal") || "Open song path"}
        </summary>
        <p className="mt-3 font-serif-italic text-[14px] leading-[1.5] text-[#6F6A63]">
          {t("song.lineage.original") || "This one is still the original branch point."}
        </p>
      </motion.details>
    );
  }

  return (
    <motion.details
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.21, duration: 0.55 }}
      className="mt-6 rounded-[20px] border border-[#E5DDD0] bg-white/78 px-4 py-4"
    >
      <summary className="cursor-pointer list-none font-ui-label text-[#B7AEA1]">
        {t("song.lineage.reveal") || "Open song path"}
      </summary>
      <p className="mt-3 font-serif-italic text-[14px] leading-[1.5] text-[#6F6A63]">
        {(t("song.lineage.branch_body") || "This song keeps a trail back to the versions it grew from.")
          .replace("{depth}", String(song.lineageDepth ?? 0))}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {trail.map((node, index) => (
          <div key={`${node.kind}-${node.song.id}`} className="contents">
            {index > 0 ? (
              <span className="px-1 text-[12px] text-[#B7AEA1]">→</span>
            ) : null}
            <LineageTrailCard
              label={
                node.kind === "root"
                  ? t("song.lineage.root") || "Root"
                  : node.kind === "parent"
                    ? t("song.lineage.parent") || "Parent"
                    : t("song.lineage.current") || "Current"
              }
              song={node.song}
              current={node.song.id === song.id}
              lang={lang}
              onOpenSong={onOpenSong}
            />
          </div>
        ))}
      </div>
    </motion.details>
  );
}

function SourceTracePanel({
  song,
  melodyOrigin,
  t,
}: {
  song: Song;
  melodyOrigin: ReturnType<typeof getMelodyOriginCopy>;
  t: (key: string) => string;
}) {
  const depth = song.lineageDepth ?? 0;
  const branchLabel =
    depth > 0
      ? (t("song.trace.branch.depth") || "Branch depth {depth}").replace(
          "{depth}",
          String(depth),
        )
      : t("song.trace.branch.original") || "Original take";

  return (
    <motion.details
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.55 }}
      className="mt-6 rounded-[20px] border border-[#E5DDD0] bg-white/78 px-4 py-4"
    >
      <summary className="cursor-pointer list-none font-ui-label text-[#B7AEA1]">
        {t("song.trace.reveal") || "Open source trace"}
      </summary>
      <p className="mt-3 font-serif-italic text-[14px] leading-[1.5] text-[#6F6A63]">
        {t("song.trace.body") ||
          "This is where Murmur quietly keeps the story of how this version landed here."}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <TraceCard
          eyebrow={t("song.trace.melody") || "Melody stance"}
          title={melodyOrigin.label}
          body={melodyOrigin.detailBody}
        />
        <TraceCard
          eyebrow={t("song.trace.branch") || "Version path"}
          title={branchLabel}
          body={
            depth > 0
              ? t("song.trace.branch.body") ||
                "You can trace this version back through earlier branches in the song path below."
              : t("song.trace.branch.original_body") ||
                "This one is still the first saved branch point for this melody idea."
          }
        />
        <TraceCard
          eyebrow={t("song.trace.editing") || "Editing cue"}
          title={t("song.trace.editing.title") || "Where to push next"}
          body={melodyOrigin.studioBody}
        />
      </div>
    </motion.details>
  );
}

function TraceCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[18px] border border-[#ECE2D5] bg-[#FFFCF8] px-4 py-4">
      <p className="font-ui-label text-[#B7AEA1]">
        {eyebrow}
      </p>
      <p className="mt-2 font-serif text-[18px] leading-tight text-[#1A1A1A]">
        {title}
      </p>
      <p className="mt-2 text-[12px] leading-[1.55] text-[#6F6A63]">{body}</p>
    </div>
  );
}

function LineageTrailCard({
  label,
  song,
  current,
  lang,
  onOpenSong,
}: {
  label: string;
  song: RelatedSong;
  current: boolean;
  lang: Lang;
  onOpenSong: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!current) onOpenSong(song.id);
      }}
      disabled={current}
      className={`rounded-[18px] border px-4 py-3 text-left transition-colors ${
        current
          ? "border-[#FFC9B3] bg-[#FFF4EE]"
          : "border-[#E8DECF] bg-[#FFFEFB] enabled:hover:border-[#FF8A5C]"
      } disabled:opacity-100`}
    >
      <p className="font-ui-label text-[#B3AA9C]">{label}</p>
      <p
        className={`mt-1 ${titleSerifClass(song.title, {
          latin: "font-serif-latin",
          cjk: "font-serif",
        })} text-[16px] leading-tight text-[#1A1A1A]`}
      >
        {song.title}
      </p>
      {song.vibe ? (
        <p className="mt-1 text-[12px] text-[#8C8780]">
          {displayVibeLabel(song.vibe, song.tags, lang)}
        </p>
      ) : null}
    </button>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors ${
        danger
          ? "text-[#D9421A] hover:bg-[#FFE6DA]"
          : "text-[#1A1A1A] hover:bg-[#F5F1EB]"
      }`}
    >
      {children}
    </button>
  );
}

function shareLinkErrorMessage(
  code: SongShareRequestErrorCode,
  t: (key: string) => string,
): string {
  switch (code) {
    case "unauthorized":
      return t("song.share.link_failed_auth") || "Sign in before creating a share link.";
    case "audio_required":
      return t("song.share.link_failed_audio") || "Audio is still rendering or unavailable.";
    case "rate_limited":
      return t("song.share.link_failed_rate_limited") || "Too many share attempts. Try again shortly.";
    case "clipboard_unavailable":
      return t("song.share.link_failed_clipboard") || "The link was created, but couldn't be copied.";
    case "network_error":
      return t("song.share.link_failed_network") || "Couldn't reach Murmur to create the link.";
    case "not_found":
      return t("song.share.link_failed_not_found") || "This song is no longer available to share.";
    case "schema_unavailable":
      return t("song.share.link_failed_schema") || "Sharing is not ready on this deployment yet.";
    default:
      return t("song.share.link_failed") || "Couldn't create a share link.";
  }
}
