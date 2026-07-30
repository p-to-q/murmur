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
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
import { isIncompleteSongArtifact } from "@/modules/music/song-artifact";
import { getMelodyOriginCopy } from "@/modules/music/melody-origin";
import { displayVibeLabel } from "@/lib/music/display-vibe";
import { copyTextToClipboard } from "@/lib/platform/clipboard";
import { downloadUrlAsFile } from "@/lib/platform/download";
import { requestWithTimeout, withTimeout } from "@/lib/api/timeout";
import {
  createSongShareLink,
  SongShareRequestError,
  type SongShareRequestErrorCode,
} from "@/lib/api/song-share";
import { hasSongShareAudio } from "@/lib/share/song-share";
import {
  formatShareSupportCode,
  formatSupportCode,
  formatVibeSupportCode,
} from "@/lib/observability/support-code";
import {
  ApiEnvelopeError,
  apiErrorEnvelopeFrom,
  readApiErrorEnvelope,
} from "@/lib/api/error-envelope";
import type { SongCard } from "@/modules/shared/types";
import { resolveClientSongAudioUrl } from "@/lib/music/song-audio-client";

type Song = SongCard & {
  audioUrl?: string | null;
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
type SongLoadResult = { status: "found"; song: Song } | { status: "not_found" };
type PublicSongDetail = Omit<Song, "arrangementState"> & {
  arrangementState?: Song["arrangementState"];
};
const CJK_TEXT_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

// Pick the download extension for an audio source. Handles both legacy base64
// data URLs (`data:audio/wav;\u2026`) and object-storage URLs (`\u2026/master.wav`);
// defaults to mp3, which is what the renderer emits on the happy path.
function audioFileExtension(audioSrc: string): "wav" | "mp3" {
  if (/^data:audio\/(wav|x-wav|wave)/i.test(audioSrc)) return "wav";
  if (/\.wav(?:[?#]|$)/i.test(audioSrc)) return "wav";
  return "mp3";
}

// Shared entry-motion vocabulary for the detail screen: a staggered
// fade + slide-up on the app's signature ease. Honors reduced-motion by
// collapsing to an instant, offset-free reveal. Spread onto any motion.*.
type EntryOpts = { y?: number; scale?: number; delay?: number; duration?: number };
function entryMotion(reduce: boolean | null, opts: EntryOpts = {}) {
  const { y = 0, scale, delay = 0, duration = 0.55 } = opts;
  if (reduce) {
    return { initial: false as const, animate: { opacity: 1 } };
  }
  const initial: { opacity: number; y?: number; scale?: number } = { opacity: 0 };
  const animate: { opacity: number; y?: number; scale?: number } = { opacity: 1 };
  if (y) {
    initial.y = y;
    animate.y = 0;
  }
  if (scale) {
    initial.scale = scale;
    animate.scale = 1;
  }
  return {
    initial,
    animate,
    transition: { delay, duration, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  };
}

export async function loadSongDetailOnce(songId: string): Promise<SongLoadResult> {
  const sessionReady = await ensureLocalCreatorSession();
  if (sessionReady) {
    const response = await requestWithTimeout(`/api/songs/${songId}`, {}, 10_000);
    const result = await readSongDetailResponse(response);
    if (result.status === "found") return result;
  }

  return loadPublicSongDetailFallback(songId);
}

export async function readSongDetailResponse(response: Response): Promise<SongLoadResult> {
  if (response.ok) return { status: "found", song: (await response.json()) as Song };
  if (response.status === 404 || response.status === 410) return { status: "not_found" };
  throw new ApiEnvelopeError(await readApiErrorEnvelope(response, "song_load_failed"));
}

async function loadPublicSongDetailFallback(songId: string): Promise<SongLoadResult> {
  const response = await requestWithTimeout(
    `/api/public/songs/${encodeURIComponent(songId)}`,
    {},
    10_000,
  );
  if (response.status === 404 || response.status === 410) return { status: "not_found" };
  if (!response.ok) {
    throw new ApiEnvelopeError(await readApiErrorEnvelope(response, "song_load_failed"));
  }
  const publicSong = (await response.json()) as PublicSongDetail;
  return { status: "found", song: publicSongToSong(publicSong) };
}

function publicSongToSong(publicSong: PublicSongDetail): Song {
  return {
    ...publicSong,
    arrangementState:
      publicSong.arrangementState ??
      fallbackArrangementState(),
  };
}

function fallbackArrangementState(): Song["arrangementState"] {
  return {
    melody: {
      enabled: true,
      intensity: 0.85,
      instrument: "piano",
      originalPattern: "",
      currentPattern: "",
      versionHistory: [],
    },
    chords: {
      enabled: true,
      intensity: 0.45,
      instrument: "piano",
      originalPattern: "",
      currentPattern: "",
      versionHistory: [],
    },
    strings: {
      enabled: true,
      intensity: 0.35,
      instrument: "strings",
      originalPattern: "",
      currentPattern: "",
      versionHistory: [],
    },
    drums: {
      enabled: true,
      intensity: 0.35,
      instrument: "drums",
      originalPattern: "",
      currentPattern: "",
      versionHistory: [],
    },
    bass: {
      enabled: true,
      intensity: 0.4,
      instrument: "bass",
      originalPattern: "",
      currentPattern: "",
      versionHistory: [],
    },
    texture: {
      enabled: true,
      intensity: 0.25,
      instrument: "pad",
      originalPattern: "",
      currentPattern: "",
      versionHistory: [],
    },
  };
}

export function SongDetailScreen({ songId }: { songId: string }) {
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const reduceMotion = useReducedMotion();
  const setCurrentVersion = useMurmurStore((state) => state.setCurrentVersion);
  const setVibeVersions = useMurmurStore((state) => state.setVibeVersions);
  const setCurrentDraftId = useMurmurStore((state) => state.setCurrentDraftId);
  const setCurrentFlowId = useMurmurStore((state) => state.setCurrentFlowId);

  const [song, setSong] = useState<Song | null>(null);
  const [parentSong, setParentSong] = useState<RelatedSong | null>(null);
  const [rootSong, setRootSong] = useState<RelatedSong | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<ExportKey | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRemixing, setIsRemixing] = useState(false);
  const [shareCardOpen, setShareCardOpen] = useState(false);
  const [shareCardMode, setShareCardMode] = useState<ShareCardMode>("image");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!deleteOpen) return;

    deleteReturnFocusRef.current = document.activeElement as HTMLElement | null;
    deleteCancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeleteOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      deleteReturnFocusRef.current?.focus();
    };
  }, [deleteOpen]);

  /* ── Load ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoading(true);
      setLoadError(false);
      try {
        const result = await loadSongDetailOnce(songId);
        if (result.status === "not_found") {
          if (active) setSong(null);
          return;
        }
        const data = result.song;
        if (!active) return;
        const previousAudio = audioRef.current;
        if (previousAudio) {
          previousAudio.pause();
          previousAudio.removeAttribute("src");
          audioRef.current = null;
          setIsPlaying(false);
        }
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
        if (active) setLoadError(true);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadAttempt, songId]);

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
      toast.error(t("cards.play_error") || "Playback failed — please retry", {
        description: formatSupportCode({ area: "SONG", error: "playback_failed", requestId: null }),
      });
      setIsPlaying(false);
    }
  }, [song, isPlaying, t]);

  const handlePlay = useCallback(async () => {
    if (!song) return;
    const audioSrc = resolveClientSongAudioUrl(song);
    if (audioSrc) {
      let el = audioRef.current;
      if (!el) {
        el = new Audio(audioSrc);
        el.preload = "auto";
        el.addEventListener("ended", () => setIsPlaying(false));
        el.addEventListener("pause", () => setIsPlaying(false));
        el.addEventListener("play", () => setIsPlaying(true));
        el.addEventListener("error", () => setIsPlaying(false));
        el.addEventListener("stalled", () => setIsPlaying(false));
        audioRef.current = el;
      }
      if (el.paused) {
        try {
          await withTimeout(el.play(), 8_000, "Song playback timed out");
        } catch (err) {
          console.error("[SongDetail] audio play failed:", err);
          el.pause();
          el.removeAttribute("src");
          audioRef.current = null;
          setIsPlaying(false);
          toast.error(t("cards.play_error") || "Playback failed — please retry", {
            description: formatSupportCode({ area: "SONG", error: "playback_failed", requestId: null }),
          });
        }
      } else {
        el.pause();
      }
      return;
    }
    await playWithTone();
  }, [song, playWithTone, t]);

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
    if (busy) return;
    if (!song) return;
    const audioSrc = resolveClientSongAudioUrl(song);
    if (!audioSrc) {
      toast(t("song.share.no_audio"));
      return;
    }
    setBusy("audio");
    try {
      const ext = audioFileExtension(audioSrc);
      const downloadUrl = audioSrc.startsWith("/api/")
        ? `${audioSrc}${audioSrc.includes("?") ? "&" : "?"}download=1`
        : audioSrc;
      const downloadedFilename = await downloadUrlAsFile(downloadUrl, `${slug}.${ext}`);
      const deliveredFormat = /\.wav$/i.test(downloadedFilename) ? "wav" : ext;
      toast.success(t("song.export.ok"));
      memory
        .reportAction({
          content: `Exported audio for "${song.title}"`,
          event_type: "update",
          page: "song-detail",
          metadata: { type: "download_audio", song_id: song.id, format: deliveredFormat },
        })
        .catch(() => {});
    } catch (error) {
      console.error(error);
      toast.error(t("song.export.err"), {
        description: formatShareSupportCode({ code: "export_failed", requestId: null }),
      });
    } finally {
      setBusy(null);
    }
  };

  const exportVideo = useCallback(async () => {
    if (busy) return;
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
  }, [busy, song, t]);

  const copyShareLink = useCallback(async () => {
    if (busy) return;
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

      setSong((current) =>
        current && current.id === song.id
          ? {
              ...current,
              shareCode: share.shareCode,
              visibility: share.visibility,
            }
          : current,
      );

      const copied = await copyTextToClipboard(share.url);
      if (!copied) {
        window.open(share.url, "_blank", "noopener,noreferrer");
        toast.success(
          t("song.share.link_opened") ||
            "Share link created and opened in a new tab",
        );
        return;
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
  }, [busy, song, t]);

  /* ── Delete ────────────────────────────────────────────────────────── */

  const handleDelete = async () => {
    if (!song || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await requestWithTimeout(`/api/songs/${song.id}`, { method: "DELETE" }, 10_000);
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
      setIsDeleting(false);
    }
  };

  /* ── Render guards ────────────────────────────────────────────────── */

  if (isLoading) {
    return <GlobalLoadingIndicator />;
  }

  if (loadError) {
    return (
      <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
        <PageBackdrop />
        <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
          <p className="eyebrow mb-3 text-[#FF8A5C]">{t("song.load_error.eyebrow") || "SONG"}</p>
          <h1 className="hero-serif text-[28px] text-[#1A1A1A] md:text-[40px]">
            {t("song.load_error.title") || "Couldn't open this song."}
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#6F6A63]">
            {t("song.load_error.body") || "It may be a temporary connection problem. Try again."}
          </p>
          <button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="mm-btn-primary mt-8">
            {t("song.load_error.retry") || "Try again"}
          </button>
        </div>
      </div>
    );
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
  const audioSrc = resolveClientSongAudioUrl(song);
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

  const handleRemixAgain = async () => {
    if (isRemixing) return;
    setIsRemixing(true);
    try {
      const versions = await buildSavedSongRemixVersions(song);
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
    } catch (error) {
      console.error("[SongDetail] remix error:", error);
      toast.error(t("vibe.gen.engine_warming") || "Music engine is warming up — try again in a moment.", {
        description: formatVibeSupportCode({ code: "remix_failed", requestId: null }),
      });
    } finally {
      setIsRemixing(false);
    }
  };

  return (
    <div data-testid="song-detail-screen" className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
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
        <div className="flex-1 px-5 md:px-10 lg:px-16 pb-28">
          <div className="mx-auto max-w-2xl">
            {/* Cover */}
            <motion.div
              {...entryMotion(reduceMotion, { y: 14, scale: 0.97, duration: 0.7 })}
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
                <p className="text-[10px] uppercase tracking-[0.32em] text-white/72">
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
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    startAudioContext();
                    void handlePlay();
                  }}
                  aria-label={isPlaying ? t("common.pause") : t("common.play")}
                  aria-pressed={isPlaying}
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
                </motion.button>
              </div>
            </motion.div>

            {/* Meta row */}
            <motion.div
              {...entryMotion(reduceMotion, { y: 6, delay: 0.1 })}
              className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.22em] text-[#8C8780]"
            >
              <span className="tabular-nums">{song.bpm ?? 80} BPM</span>
              <span className="text-[#D2C9B6]">·</span>
              <span>{song.keySignature ?? "C"}</span>
              <span className="text-[#D2C9B6]">·</span>
              <span className="tabular-nums">{durLabel}</span>
              <span className="text-[#D2C9B6]">·</span>
              <span>{dateLabel}</span>
            </motion.div>

            <motion.div
              {...entryMotion(reduceMotion, { y: 6, delay: 0.13 })}
              className="mt-4 rounded-[20px] border border-[#E5DDD0] bg-[#FFFEFB]/80 px-4 py-3"
            >
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#B7AEA1]">
                {t("song.melody_origin.eyebrow") || "MELODY SHAPE"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-[#F3E7D9] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#A56A3A]">
                  {melodyOrigin.label}
                </span>
                <p className="font-serif-italic text-[14px] leading-[1.45] text-[#6F6A63]">
                  {melodyOrigin.detailBody}
                </p>
              </div>
            </motion.div>

            {/* Editorial caption */}
            <motion.p
              {...entryMotion(reduceMotion, { y: 6, delay: 0.18 })}
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
              reduceMotion={reduceMotion}
            />

            <LineagePanel
              song={song}
              parentSong={effectiveParentSong}
              rootSong={effectiveRootSong}
              t={t}
              lang={lang}
              onOpenSong={(id) => router.push(`/song/${id}`)}
              reduceMotion={reduceMotion}
            />

            {/* Incomplete/draft state — audio never rendered (#291) */}
            {isIncompleteSongArtifact(song) && (
              <motion.div
                {...entryMotion(reduceMotion, { y: 6, delay: 0.2 })}
                className="mt-10 rounded-[18px] border border-[#E7C9B3] bg-[#FBF1E9] px-5 py-4"
              >
                <p className="text-[10px] uppercase tracking-[0.2em] text-[#B26B45]">
                  {t("song.incomplete.badge") || "Incomplete draft"}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#8A6A57]">
                  {t("song.incomplete.body") ||
                    "This song's audio didn't finish rendering, so it can't be shared or downloaded yet. Reopen it in the studio to finish it."}
                </p>
              </motion.div>
            )}

            {/* Export list */}
            <motion.p
              {...entryMotion(reduceMotion, { delay: 0.24, duration: 0.5 })}
              className="eyebrow mt-12 text-[#FF8A5C]"
            >
              {t("song.export.eyebrow") || "EXPORT"}
            </motion.p>
            <motion.div
              {...entryMotion(reduceMotion, { y: 6, delay: 0.28 })}
              className="mt-3 divide-y divide-[#E5DDD0] border-t border-b border-[#E5DDD0]"
            >
              <ExportRow
                label={t("song.share.link.label") || "Share link"}
                hint={t("song.share.link.hint") || "Anyone with the link can listen"}
                cost={t("song.export.free") || "free"}
                disabled={busy !== null || !audioReady}
                disabledHint={t("song.export.no_audio_yet") || "not yet rendered"}
                busy={busy === "link"}
                icon={<Copy className="h-4 w-4" />}
                onClick={copyShareLink}
              />
              <ExportRow
                label={t("song.export.audio.label") || "Audio"}
                hint={t("song.export.audio.hint") || "mp3"}
                cost={t("song.export.free") || "free"}
                disabled={busy !== null || !audioReady}
                disabledHint={t("song.export.no_audio_yet") || "not yet rendered"}
                busy={busy === "audio"}
                onClick={exportAudio}
              />
              <ExportRow
                label={t("song.export.image.label") || "Share image"}
                hint={t("song.export.image.hint") || "png"}
                cost={t("song.export.free") || "free"}
                disabled={busy !== null}
                busy={busy === "share"}
                onClick={() => {
                  if (busy) return;
                  setShareCardMode("image");
                  setShareCardOpen(true);
                }}
              />
              <ExportRow
                label={t("song.export.video.label") || "Video"}
                hint={t("song.export.video.hint") || "mp4"}
                cost={t("song.export.free") || "free"}
                disabled={busy !== null || !audioReady}
                disabledHint={t("song.export.no_audio_yet") || "not yet rendered"}
                busy={busy === "video"}
                onClick={() => {
                  if (busy) return;
                  setShareCardMode("video");
                  setShareCardOpen(true);
                }}
              />
            </motion.div>

            {/* Tertiary footer */}
            <motion.div
              {...entryMotion(reduceMotion, { delay: 0.4, duration: 0.5 })}
              className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2"
            >
              <button
                type="button"
                onClick={handleRemixAgain}
                disabled={isRemixing}
                className="font-serif-italic text-[15px] text-[#1A1A1A] hover:text-[#B83212] underline-mm transition-colors disabled:pointer-events-none disabled:opacity-50"
              >
                {isRemixing
                  ? (t("vibe.gen.brewing") || "Brewing")
                  : (t("song.remix_again") || "Try new versions")}
              </button>
              <button
                type="button"
                onClick={handleEditAgain}
                className="font-serif-italic text-[15px] text-[#B83212] underline-mm transition-colors"
              >
                {t("song.edit_again") || "Edit again"}
              </button>
              <button
                type="button"
                onClick={() => router.push("/gallery")}
                className="font-serif-italic text-[15px] text-[#8C8780] hover:text-[#1A1A1A] underline-mm transition-colors"
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
            role="presentation"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="mm-card w-full max-w-sm px-6 py-7 text-center"
              role="dialog"
              aria-modal="true"
              aria-labelledby="song-delete-title"
              aria-describedby="song-delete-description"
            >
              <p className="eyebrow text-[#FF8A5C] mb-3">{t("song.delete.eyebrow") || "REMOVE"}</p>
              <h3 id="song-delete-title" className="font-serif text-[24px] text-[#1A1A1A] leading-tight">
                {t("song.delete.title") || "Delete this little song?"}
              </h3>
              <p id="song-delete-description" className="mt-2 text-[13px] text-[#8C8780] leading-relaxed">
                {t("song.delete.body") ||
                  "It will be gone from your gallery. You can hum it again later."}
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  ref={deleteCancelRef}
                  onClick={() => setDeleteOpen(false)}
                  className="flex-1 h-11 rounded-[18px] border border-[#E5DDD0] text-[#1A1A1A] text-[14px] hover:bg-white transition-colors"
                >
                  {t("common.cancel") || "Keep"}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex-1 h-11 rounded-[18px] bg-[#1A1A1A] text-white text-[14px] hover:bg-[#3A3A3A] transition-colors disabled:opacity-50"
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
    const response = await requestWithTimeout(`/api/songs/${songId}?view=summary`, {}, 8_000);
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
        <span className="text-[11px] uppercase tracking-[0.22em] text-[#B6B0A4]">
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
  reduceMotion,
}: {
  song: Song;
  parentSong: RelatedSong | null;
  rootSong: RelatedSong | null;
  t: (key: string) => string;
  lang: Lang;
  onOpenSong: (id: string) => void;
  reduceMotion: boolean | null;
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
        {...entryMotion(reduceMotion, { y: 6, delay: 0.21 })}
        className="mt-6 rounded-[20px] border border-[#E5DDD0] bg-white/78 px-4 py-4"
      >
        <summary className="cursor-pointer list-none text-[10px] uppercase tracking-[0.24em] text-[#B7AEA1]">
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
      {...entryMotion(reduceMotion, { y: 6, delay: 0.21 })}
      className="mt-6 rounded-[20px] border border-[#E5DDD0] bg-white/78 px-4 py-4"
    >
      <summary className="cursor-pointer list-none text-[10px] uppercase tracking-[0.24em] text-[#B7AEA1]">
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
  reduceMotion,
}: {
  song: Song;
  melodyOrigin: ReturnType<typeof getMelodyOriginCopy>;
  t: (key: string) => string;
  reduceMotion: boolean | null;
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
      {...entryMotion(reduceMotion, { y: 6, delay: 0.2 })}
      className="mt-6 rounded-[20px] border border-[#E5DDD0] bg-white/78 px-4 py-4"
    >
      <summary className="cursor-pointer list-none text-[10px] uppercase tracking-[0.24em] text-[#B7AEA1]">
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
      <p className="text-[10px] uppercase tracking-[0.18em] text-[#B7AEA1]">
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
      <p className="text-[10px] uppercase tracking-[0.18em] text-[#B3AA9C]">{label}</p>
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
