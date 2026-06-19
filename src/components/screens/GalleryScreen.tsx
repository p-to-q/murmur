"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { memory } from "@/lib/platform/memory";
import { ensureLocalCreatorSession } from "@/lib/auth/local-creator-client";

import { useTranslator } from "@/lib/i18n";
import { displayVibeLabel } from "@/lib/music/display-vibe";
import type { SongCard as SongCardType } from "@/modules/shared/types";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { SongCard } from "@/components/gallery/SongCard";
import { ActivityHeatmap } from "@/components/gallery/ActivityHeatmap";
import { Spinner } from "@/components/ui/spinner";
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

function demoArtwork(id: string) {
  const artwork = ARTWORK_CATALOG.find((entry) => entry.id === id);
  if (!artwork) throw new Error(`Missing demo artwork: ${id}`);
  return artwork;
}

// Demo songs for empty state — gradients keep their covers on the same
// rendering path as real songs.
const DEMO_SONGS: SongWithMeta[] = [
  {
    id: "demo-1",
    title: "Velvet Nocturne",
    vibe: "Melancholic",
    bpm: 72,
    createdAt: "2026-06-11T10:00:00.000Z",
    visualConfig: {
      preset: "end_credits",
      gradient: "linear-gradient(148deg, #4E5D6E 0%, #8B96A6 48%, #D8D0C4 100%)",
      particleDensity: 0.4,
      pulseSource: "melody",
      artwork: demoArtwork("nocturne_metro-commons-whistler-nocturne-southampton-water"),
    },
  },
  {
    id: "demo-2",
    title: "Tokyo Rain",
    vibe: "Lo-fi",
    bpm: 88,
    createdAt: "2026-06-08T10:00:00.000Z",
    visualConfig: {
      preset: "rain_glass",
      gradient: "linear-gradient(148deg, #5A8EAA 0%, #9DB8C0 48%, #DFE0DA 100%)",
      particleDensity: 0.35,
      pulseSource: "melody",
      artwork: demoArtwork("nocturne_metro-commons-hassam-rainy-day-fifth-avenue"),
    },
  },
  {
    id: "demo-3",
    title: "Wilderness Dream",
    vibe: "Ethereal",
    bpm: 105,
    createdAt: "2026-06-05T10:00:00.000Z",
    visualConfig: {
      preset: "warm_particles",
      gradient: "linear-gradient(148deg, #A8C8E8 0%, #E8E2F4 48%, #7FA6CC 100%)",
      particleDensity: 0.45,
      pulseSource: "melody",
      artwork: demoArtwork("sublime_terrain-manual-saam-1967.136.7"),
    },
  },
];

function displayVibe(song: SongWithMeta): string {
  return displayVibeLabel(song.vibe, song.tags);
}

export function GalleryScreen() {
  const router = useRouter();
  const t = useTranslator();
  const [songs, setSongs] = useState<SongWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("newest");
  const [deleteTarget, setDeleteTarget] = useState<SongWithMeta | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [demoPreview, setDemoPreview] = useState<SongWithMeta | null>(null);

  // Use demo songs when user has no real songs
  const displaySongs = songs.length > 0 ? songs : DEMO_SONGS;
  const isShowingDemo = songs.length === 0;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        await ensureLocalCreatorSession({ background: true });
        const res = await fetch("/api/songs");
        if (res.ok) {
          const data = (await res.json()) as SongWithMeta[];
          if (!cancelled) setSongs(data);
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

  const handleSongClick = (song: SongWithMeta) => {
    if (song.id.startsWith("demo-")) {
      setDemoPreview(song);
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
                vibe: displayVibe(s),
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

      {/* Music note animation — empty-state filler only; with real songs it
          pushed the grid below the fold for nothing */}
      {!isLoading && isShowingDemo && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex flex-col items-center px-5 md:px-12 py-8 md:py-12 max-w-2xl mx-auto text-center"
        >
          <svg
            width="160"
            height="160"
            viewBox="0 0 120 120"
            fill="none"
            className="opacity-20"
          >
            <motion.circle
              initial={{ scale: 0.75, opacity: 0.15 }}
              animate={{ scale: 1, opacity: 0.5 }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                repeatType: "reverse",
                ease: "easeInOut",
              }}
              cx="60"
              cy="80"
              r="12"
              fill="#FF5924"
            />
            <motion.path
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                repeatType: "reverse",
                ease: "easeInOut",
              }}
              d="M 72 80 L 72 30 Q 72 20 82 22 L 100 26"
              stroke="#FF5924"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </motion.div>
      )}

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

      {/* Loading — general spinner (the skeleton grid never matched the real
          cover layout, so it read as a glitch rather than a placeholder) */}
      {isLoading && (
        <div className="relative z-10 flex min-h-[60svh] items-center justify-center">
          <Spinner size="lg" aria-label={t("loading.aria")} />
        </div>
      )}

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
                {t("gallery.demo.hint") || "这些是示例歌曲，点击开始创作你的第一首 ↓"}
              </p>
            </motion.div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5 xl:gap-6">
            {sorted.map((song, i) => (
              <SongCard
                key={song.id}
                id={song.id}
                title={song.title}
                vibe={displayVibe(song)}
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
            className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1A1A1A]/45 backdrop-blur-sm px-5"
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

      {/* Demo song preview */}
      <AnimatePresence>
        {demoPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-[#1A1A1A]/45 backdrop-blur-sm"
            onClick={() => setDemoPreview(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md md:rounded-[24px] rounded-t-[24px] overflow-hidden"
            >
              <div
                className="relative h-[240px] flex items-end p-6"
                style={{ background: demoPreview.visualConfig?.gradient || "linear-gradient(135deg, #8B96A6, #D8D0C4)" }}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                <div className="relative z-10">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-white/55 mb-1">
                    {displayVibe(demoPreview)} · {demoPreview.bpm} BPM
                  </p>
                  <h3 className="hero-serif text-white text-[28px] leading-tight">
                    {demoPreview.title}
                  </h3>
                </div>
              </div>
              <div className="bg-white px-6 py-6 text-center space-y-4">
                <p className="text-[13px] text-[#8C8780] leading-relaxed">
                  {t("gallery.demo.preview_hint") || "这是一首示例歌曲，哼一段旋律来创作属于你自己的。"}
                </p>
                <button
                  onClick={() => { setDemoPreview(null); router.push("/"); }}
                  className="w-full h-12 rounded-[18px] bg-[#1A1A1A] text-white text-[14px] font-medium hover:bg-[#3A3A3A] transition-colors"
                >
                  {t("gallery.demo.cta_create") || "开始创作"}
                </button>
                <button
                  onClick={() => setDemoPreview(null)}
                  className="text-[13px] text-[#8C8780] hover:text-[#1A1A1A] transition-colors"
                >
                  {t("common.cancel") || "返回"}
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
