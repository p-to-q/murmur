"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
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
import { useNotificationStore } from "@/lib/store/notification-store";
import { ActivityHeatmap } from "@/components/gallery/ActivityHeatmap";
import { ARTWORK_CATALOG } from "@/presets/artworks/catalog";

// The gallery only renders light metadata; the heavy SongCard fields
// (visualConfig, duration, arrangementState) stay optional so demo
// placeholders don't have to fabricate them.
type SongWithMeta = Omit<SongCardType, "visualConfig" | "duration" | "arrangementState"> &
  Partial<Pick<SongCardType, "visualConfig" | "duration" | "arrangementState">> & {
    bpm?: number;
    keySignature?: string;
    tags?: string[];
  };
type SortMode = "newest" | "alpha";
const LOCAL_CREATOR_BOOTSTRAP_TIMEOUT_MS = 2_000;
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

export async function loadGallerySongsOnce(): Promise<SongWithMeta[] | null> {
  const hasSession = await withSoftTimeout(
    ensureLocalCreatorSession({ background: true }),
    LOCAL_CREATOR_BOOTSTRAP_TIMEOUT_MS,
    false,
  );
  if (!hasSession) return null;

  const first = await fetch(SONGS_ROUTE);
  if (first.ok) return (await first.json()) as SongWithMeta[];
  if (first.status !== 401) return null;

  clearLocalCreatorBootstrapFlag();
  const refreshed = await withSoftTimeout(
    ensureLocalCreatorSession({ background: true, force: true }),
    LOCAL_CREATOR_BOOTSTRAP_TIMEOUT_MS,
    false,
  );
  if (!refreshed) return null;

  const second = await fetch(SONGS_ROUTE);
  if (!second.ok) return null;
  return (await second.json()) as SongWithMeta[];
}

export function GalleryScreen() {
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const [songs, setSongs] = useState<SongWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("newest");
  const [deleteTarget, setDeleteTarget] = useState<SongWithMeta | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Use demo songs when user has no real songs
  const displaySongs = songs.length > 0 ? songs : DEMO_SONGS;
  const isShowingDemo = songs.length === 0;

  const markAllRead = useNotificationStore((s) => s.markAllRead);
  useEffect(() => {
    trackStageEntered("gallery");
    markAllRead();
  }, [markAllRead]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await loadGallerySongsOnce();
        if (data && !cancelled) {
          setSongs(data);
        }
      } catch {
        /* offline — keep whatever we have */
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (isLoading) {
    return <GlobalLoadingIndicator />;
  }

  const handleSongClick = (song: SongWithMeta) => {
    memory
      .reportAction({
        content: `Opened "${song.title}" from gallery`,
        event_type: "navigate",
        page: "gallery",
        metadata: { type: "open_song", song_id: song.id },
      })
      .catch(() => {});
    router.push(`/song/${song.id}`);
  };

  const handleConfirmDelete = async () => {
    const target = deleteTarget;
    if (!target || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/songs/${target.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`delete HTTP ${res.status}`);
      setSongs((prev) => prev.filter((s) => s.id !== target.id));
      setDeleteTarget(null);
      memory
        .reportAction({
          content: `Deleted "${target.title}" from gallery`,
          event_type: "delete",
          page: "gallery",
          metadata: { type: "song_delete", song_id: target.id },
        })
        .catch(() => {});
      toast.success(t("gallery.delete.done") || "Deleted.");
    } catch {
      toast.error(t("song.delete.failed") || "Couldn't delete that one. Try again?");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
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
              onSongClick={(id) => {
                const song = displaySongs.find((s) => s.id === id);
                if (song) handleSongClick(song);
              }}
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
                onClick={() => handleSongClick(song)}
                onDelete={
                  isShowingDemo ? undefined : () => setDeleteTarget(song)
                }
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
              onClick={() => router.push("/")}
              className="font-serif-italic text-[15px] text-[#FF5924] hover:text-[#D9421A] underline-mm transition-colors"
            >
              ↻ {isShowingDemo
                ? (t("gallery.start_hum") || "开始哼唱")
                : (t("gallery.new_hum") || "Hum another one")}
            </button>
          </motion.div>
        </div>
      )}

      {/* Delete confirm — same dialog language as SongDetail */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-md px-5"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="mm-card w-full max-w-sm px-6 py-7 text-center"
            >
              <p className="eyebrow text-[#FF8A5C] mb-3">{t("song.delete.eyebrow") || "REMOVE"}</p>
              <h3 className="font-serif text-[24px] text-[#1A1A1A] leading-tight">
                {t("song.delete.title") || "Delete this little song?"}
              </h3>
              <p className="mt-2 text-[13px] text-[#8C8780] leading-relaxed">
                &ldquo;{deleteTarget.title}&rdquo; —{" "}
                {t("song.delete.body") ||
                  "It will be gone from your gallery. You can hum it again later."}
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 h-11 rounded-[18px] border border-[#E5DDD0] text-[#1A1A1A] text-[14px] hover:bg-white transition-colors"
                >
                  {t("common.cancel") || "Keep"}
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="flex-1 h-11 rounded-[18px] bg-[#1A1A1A] text-white text-[14px] hover:bg-[#3A3A3A] transition-colors disabled:opacity-60"
                >
                  {isDeleting ? "…" : t("song.delete.confirm") || "Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
        onClick={() => onChange("newest")}
        className={`transition-colors ${sort === "newest" ? "text-[#1A1A1A] font-medium" : "text-[#8C8780] hover:text-[#1A1A1A]"}`}
      >
        ↑ {t("gallery.sort.newest") || "newest"}
      </button>
      <span className="text-[#D2C9B6]">·</span>
      <button
        onClick={() => onChange("alpha")}
        className={`transition-colors ${sort === "alpha" ? "text-[#1A1A1A] font-medium" : "text-[#8C8780] hover:text-[#1A1A1A]"}`}
      >
        a–z
      </button>
    </div>
  );
}
