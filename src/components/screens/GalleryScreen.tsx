"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { formatSupportCode } from "@/lib/observability/support-code";
import {
  ApiEnvelopeError,
  readApiErrorEnvelope,
} from "@/lib/api/error-envelope";
import { requestWithTimeout, withTimeout } from "@/lib/api/timeout";
import { memory } from "@/lib/platform/memory";
import {
  clearLocalCreatorBootstrapFlag,
  ensureLocalCreatorSession,
} from "@/lib/auth/local-creator-client";

import { useI18nStore, useTranslator } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/dict";
import { displayVibeLabel } from "@/lib/music/display-vibe";
import type { SongCard as SongCardType } from "@/modules/shared/types";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { SongCard } from "@/components/gallery/SongCard";
import { trackStageEntered } from "@/lib/observability/stage-tracking";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { useNotificationStore } from "@/lib/store/notification-store";
import { ActivityHeatmap } from "@/components/gallery/ActivityHeatmap";
import { ARTWORK_CATALOG } from "@/presets/artworks/catalog";
import { getDemoSong, isDemoSongId } from "@/presets/demo-songs";
import { resolveClientSongAudioUrl } from "@/lib/music/song-audio-client";

// The gallery only renders light metadata; the heavy SongCard fields
// (visualConfig, duration, arrangementState) stay optional so demo
// placeholders don't have to fabricate them.
type SongWithMeta = Omit<SongCardType, "visualConfig" | "duration" | "arrangementState"> &
  Partial<Pick<SongCardType, "visualConfig" | "duration" | "arrangementState">> & {
    mp3DataUrl?: string | null;
    mp3Url?: string | null;
    audioUrl?: string | null;
    bpm?: number;
    keySignature?: string;
    tags?: string[];
  };
type SortMode = "newest" | "alpha";
const LOCAL_CREATOR_BOOTSTRAP_TIMEOUT_MS = 2_000;
const DEMO_PREVIEW_START_TIMEOUT_MS = 8_000;
const SONGS_ROUTE = "/api/songs";

function demoArtwork(id: string) {
  const artwork = ARTWORK_CATALOG.find((entry) => entry.id === id);
  if (!artwork) throw new Error(`Missing demo artwork: ${id}`);
  return artwork;
}

// Demo songs for empty state — real songs from the gallery, gradients keep
// their covers on the same rendering path as real songs.
const DEMO_SONGS: SongWithMeta[] = [
  {
    id: "demo-1",
    title: "Weightless DnB",
    vibe: "Drum and Bass",
    bpm: 80,
    createdAt: "2026-06-19T17:04:56.832Z",
    visualConfig: {
      preset: "confetti_pulse",
      gradient: "linear-gradient(148deg, #646740 0%, #314036 48%, #3E4D3D 100%)",
      particleDensity: 0.9,
      pulseSource: "drums",
      artwork: demoArtwork("hypermodern_void-commons-whistler-nocturne-black-gold-falling-rocket"),
    },
  },
  {
    id: "demo-2",
    title: "Dreamy Celtic",
    vibe: "Celtic Folk",
    bpm: 100,
    createdAt: "2026-06-17T23:32:41.212Z",
    visualConfig: {
      preset: "warm_particles",
      gradient: "linear-gradient(148deg, #8BAFC2 0%, #F0C7D8 48%, #B87FCC 100%)",
      particleDensity: 0.45,
      pulseSource: "melody",
      artwork: demoArtwork("pastoral_memory-met-436081"),
    },
  },
  {
    id: "demo-3",
    title: "Cozy Guzheng",
    vibe: "Guzheng Meditation",
    bpm: 94,
    createdAt: "2026-06-17T03:08:47.543Z",
    visualConfig: {
      preset: "rain_glass",
      gradient: "linear-gradient(148deg, #E8956B 0%, #FFBA5A 48%, #B86B4C 100%)",
      particleDensity: 0.3,
      pulseSource: "melody",
      artwork: demoArtwork("pastoral_memory-manual-monet-haystack-morning-snow-effect"),
    },
  },
];

export function gallerySongAction(songId: string, isShowingDemo: boolean): "preview" | "detail" {
  return isShowingDemo && isDemoSongId(songId) ? "preview" : "detail";
}

function displayVibe(song: SongWithMeta, lang: Lang): string {
  return displayVibeLabel(song.vibe, song.tags, lang);
}

async function withSoftTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function loadGallerySongsOnce(): Promise<SongWithMeta[]> {
  const hasSession = await withSoftTimeout(
    ensureLocalCreatorSession({ background: true }),
    LOCAL_CREATOR_BOOTSTRAP_TIMEOUT_MS,
    false,
  );
  if (!hasSession) return [];

  const first = await requestWithTimeout(SONGS_ROUTE, {}, 10_000);
  if (first.ok) return (await first.json()) as SongWithMeta[];
  if (first.status !== 401) {
    throw new ApiEnvelopeError(await readApiErrorEnvelope(first, "gallery_load_failed"));
  }

  clearLocalCreatorBootstrapFlag();
  const refreshed = await withSoftTimeout(
    ensureLocalCreatorSession({ background: true, force: true }),
    LOCAL_CREATOR_BOOTSTRAP_TIMEOUT_MS,
    false,
  );
  if (!refreshed) return [];

  const second = await requestWithTimeout(SONGS_ROUTE, {}, 10_000);
  if (!second.ok) {
    throw new ApiEnvelopeError(await readApiErrorEnvelope(second, "gallery_load_failed"));
  }
  return (await second.json()) as SongWithMeta[];
}

export function GalleryScreen() {
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const [songs, setSongs] = useState<SongWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [sort, setSort] = useState<SortMode>("newest");
  const [playingSongId, setPlayingSongId] = useState<string | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const currentFlowId = useMurmurStore((state) => state.currentFlowId);
  const currentDraftId = useMurmurStore((state) => state.currentDraftId);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewOperationRef = useRef(0);

  // Use demo songs when user has no real songs
  const displaySongs = useMemo(
    () => (loadError ? [] : songs.length > 0 ? songs : DEMO_SONGS),
    [loadError, songs],
  );
  const isShowingDemo = !loadError && songs.length === 0;

  const markAllRead = useNotificationStore((s) => s.markAllRead);
  useEffect(() => {
    markAllRead();
  }, [markAllRead]);

  useEffect(() => {
    if (!currentFlowId) return;
    trackStageEntered(currentFlowId, "gallery", {
      draftId: currentDraftId ?? undefined,
    });
  }, [currentDraftId, currentFlowId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setLoadError(false);
      try {
        const data = await loadGallerySongsOnce();
        if (!cancelled) {
          setSongs(data);
        }
      } catch (error) {
        console.warn("[Gallery] load error:", error);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  useEffect(() => {
    return () => {
      previewOperationRef.current += 1;
      const audio = previewAudioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        previewAudioRef.current = null;
      }
    };
  }, []);

  const stopSongPreview = useCallback(() => {
    previewOperationRef.current += 1;
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      previewAudioRef.current = null;
    }
    setPlayingSongId(null);
    setLoadingPreviewId(null);
  }, []);

  const toggleSongPreview = useCallback(
    async (song: SongWithMeta) => {
      if (playingSongId === song.id) {
        stopSongPreview();
        return;
      }

      const operationId = previewOperationRef.current + 1;
      previewOperationRef.current = operationId;
      const isCurrentOperation = () => previewOperationRef.current === operationId;
      const demo = isDemoSongId(song.id) ? getDemoSong(song.id) : null;
      let audioSrc = demo?.mp3Url ?? resolveClientSongAudioUrl(song);

      if (!audioSrc && !demo) {
        setLoadingPreviewId(song.id);
        try {
          const response = await requestWithTimeout(`/api/songs/${song.id}`, {}, 10_000);
          if (!isCurrentOperation()) {
            setLoadingPreviewId((current) => (current === song.id ? null : current));
            return;
          }
          if (!response.ok) {
            throw new ApiEnvelopeError(await readApiErrorEnvelope(response, "song_preview_failed"));
          }
          const fullSong = (await response.json()) as SongWithMeta;
          if (!isCurrentOperation()) {
            setLoadingPreviewId((current) => (current === song.id ? null : current));
            return;
          }
          audioSrc = resolveClientSongAudioUrl(fullSong);
        } catch (error) {
          if (!isCurrentOperation()) return;
          console.error("[Gallery] song preview load failed:", error);
          toast.error(t("cards.play_error") || "Playback failed, please retry", {
            description: formatSupportCode({ area: "GALLERY", error: "preview_load_failed", requestId: null }),
          });
          setLoadingPreviewId(null);
          return;
        }
      }

      if (!audioSrc) {
        if (!isCurrentOperation()) return;
        toast.error(t("cards.play_error") || "Playback failed, please retry");
        setLoadingPreviewId(null);
        return;
      }

      const previousAudio = previewAudioRef.current;
      if (previousAudio) {
        previousAudio.pause();
        previousAudio.removeAttribute("src");
        previewAudioRef.current = null;
      }
      setPlayingSongId(null);
      setLoadingPreviewId(song.id);
      const audio = new Audio(audioSrc);
      audio.loop = true;
      audio.onended = () => {
        if (isCurrentOperation()) setPlayingSongId(null);
      };
      audio.onerror = () => {
        if (!isCurrentOperation()) return;
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
        setPlayingSongId(null);
        setLoadingPreviewId(null);
        toast.error(t("cards.play_error") || "Playback failed, please retry");
      };
      previewAudioRef.current = audio;

      try {
        await withTimeout(
          audio.play(),
          DEMO_PREVIEW_START_TIMEOUT_MS,
          "Gallery preview timed out",
        );
        if (!isCurrentOperation()) {
          audio.pause();
          audio.removeAttribute("src");
          return;
        }
        setPlayingSongId(song.id);
        setLoadingPreviewId(null);
        memory
          .reportAction({
            content: `Previewed "${song.title}" from gallery`,
            event_type: "play",
            page: "gallery",
            metadata: { type: demo ? "demo_preview" : "song_preview", song_id: song.id },
          })
          .catch(() => {});
      } catch (error) {
        if (!isCurrentOperation()) {
          audio.pause();
          audio.removeAttribute("src");
          return;
        }
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
        audio.removeAttribute("src");
        console.error("[Gallery] demo preview failed:", error);
        toast.error(t("cards.play_error") || "Playback failed, please retry");
        setLoadingPreviewId(null);
      }
    },
    [playingSongId, stopSongPreview, t],
  );

  const sorted = useMemo(() => {
    const list = [...displaySongs];
    if (sort === "alpha") {
      return list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [displaySongs, sort]);

  // Stable id-based handlers keep SongCard's React.memo effective — inline
  // per-card closures would give every card fresh props on each render.
  const handleSongClick = useCallback(
    (id: string) => {
      const song = displaySongs.find((s) => s.id === id);
      if (!song) return;
      if (gallerySongAction(song.id, isShowingDemo) === "preview") {
        void toggleSongPreview(song);
        return;
      }
      memory
        .reportAction({
          content: `Opened "${song.title}" from gallery`,
          event_type: "navigate",
          page: "gallery",
          metadata: { type: "open_song", song_id: song.id },
        })
        .catch(() => {});
      stopSongPreview();
      router.push(`/song/${song.id}`);
    },
    [displaySongs, isShowingDemo, router, stopSongPreview, toggleSongPreview],
  );

  const handleSongPreviewClick = useCallback(
    (id: string) => {
      const song = displaySongs.find((s) => s.id === id);
      if (song) void toggleSongPreview(song);
    },
    [displaySongs, toggleSongPreview],
  );

  if (isLoading) {
    return <GlobalLoadingIndicator />;
  }

  if (loadError) {
    return (
      <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
        <PageBackdrop variant="soft" />
        <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
          <p className="eyebrow mb-3 text-[#FF8A5C]">{t("gallery.load_error.eyebrow") || "GALLERY"}</p>
          <h1 className="hero-serif text-[28px] leading-tight text-[#1A1A1A] md:text-[40px]">
            {t("gallery.load_error.title") || "Couldn't open your gallery."}
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#6F6A63]">
            {t("gallery.load_error.body") || "Your songs are still saved. Try loading them again."}
          </p>
          <button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="mm-btn-primary mt-8">
            {t("gallery.load_error.retry") || "Try again"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="gallery-screen" className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      {/* Activity heatmap — fills the top */}
      <div
        className="relative z-10 px-5 md:px-12 max-w-7xl mx-auto"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 48px)" }}
      >
        {!isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            <ActivityHeatmap
              dates={isShowingDemo ? [] : displaySongs.map((s) => s.createdAt)}
              songCount={songs.length}
              title={t("gallery.title")}
              recentSongs={sorted.slice(0, 3).map((s) => ({
                id: s.id,
                title: s.title,
                vibe: displayVibe(s, lang),
                gradient: s.visualConfig?.gradient,
                artwork: s.visualConfig?.artwork,
                bpm: s.bpm,
                createdAt: s.createdAt,
              }))}
              onSongClick={handleSongClick}
            />
          </motion.div>
        )}
      </div>

      {/* Sort toggle — only visible when there are songs */}
      {!isLoading && displaySongs.length > 1 && (
        <div className="relative z-10 px-5 md:px-12 max-w-7xl mx-auto flex justify-end pt-2 pb-6 md:pt-0 md:pb-8">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
          >
            <SortToggle sort={sort} onChange={setSort} t={t} />
          </motion.div>
        </div>
      )}

      {/* Spacer when no sort toggle shown */}
      {!isLoading && displaySongs.length <= 1 && <div className="pb-4" />}

      {/* Song grid — 2-col mobile / 3-col tablet / 4-col desktop */}
      {!isLoading && displaySongs.length > 0 && (
        <div className="relative z-10 px-5 md:px-12 pb-32 max-w-7xl mx-auto">
          {/* Demo banner when showing demo songs */}
          {isShowingDemo && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="mb-6 md:mb-8 text-center"
            >
              <p className="font-serif-italic text-[#8C8780] text-[14px] md:text-[16px] mb-3">
                {t("gallery.demo.hint") || "这些是示例歌曲 ↓"}
              </p>
            </motion.div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5 xl:gap-6">
            {sorted.map((song, i) => (
              <SongCard
                key={song.id}
                id={song.id}
                title={song.title}
                vibe={displayVibe(song, lang)}
                gradient={song.visualConfig?.gradient}
                artwork={song.visualConfig?.artwork}
                bpm={song.bpm}
                createdAt={song.createdAt}
                index={i}
                onClick={handleSongClick}
                isDraft={song.hasAudio === false}
                draftLabel={t("gallery.draft") || "Draft"}
                onPlay={song.hasAudio === false ? undefined : handleSongPreviewClick}
                isPlaying={song.hasAudio === false ? undefined : playingSongId === song.id}
                isPlayLoading={loadingPreviewId === song.id}
                playLabel={t("common.play") || "Play"}
                pauseLabel={t("common.pause") || "Pause"}
              />
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-12 flex justify-center"
          >
            <button
              type="button"
              onClick={() => router.push("/")}
              className="font-serif-italic text-[15px] text-[#B83212] underline-mm transition-colors"
            >
              ↻ {isShowingDemo
                ? (t("gallery.start_hum") || "开始哼唱")
                : (t("gallery.new_hum") || "Hum another one")}
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function SortToggle({
  sort,
  onChange,
  t,
}: {
  sort: SortMode;
  onChange: (s: SortMode) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-[12px] tracking-[0.04em]">
      <button
        type="button"
        onClick={() => onChange("newest")}
        className={`transition-colors ${sort === "newest" ? "text-[#1A1A1A] font-medium" : "text-[#8C8780] hover:text-[#1A1A1A]"}`}
      >
        ↑ {t("gallery.sort.newest") || "newest"}
      </button>
      <span className="text-[#D2C9B6]">·</span>
      <button
        type="button"
        onClick={() => onChange("alpha")}
        className={`transition-colors ${sort === "alpha" ? "text-[#1A1A1A] font-medium" : "text-[#8C8780] hover:text-[#1A1A1A]"}`}
      >
        a–z
      </button>
    </div>
  );
}
