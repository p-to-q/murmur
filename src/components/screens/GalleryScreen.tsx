"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { memory } from "@/lib/platform/memory";

import { useTranslator } from "@/lib/i18n";
import type { SongCard as SongCardType } from "@/modules/shared/types";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { SongCard } from "@/components/gallery/SongCard";
import { ActivityHeatmap } from "@/components/gallery/ActivityHeatmap";

// The gallery only renders light metadata; the heavy SongCard fields
// (visualConfig, duration, arrangementState) stay optional so demo
// placeholders don't have to fabricate them.
type SongWithMeta = Omit<SongCardType, "visualConfig" | "duration" | "arrangementState"> &
  Partial<Pick<SongCardType, "visualConfig" | "duration" | "arrangementState">> & {
    bpm?: number;
    keySignature?: string;
  };
type SortMode = "newest" | "alpha";

// Demo songs for empty state
const DEMO_SONGS: SongWithMeta[] = [
  {
    id: "demo-1",
    title: "Velvet Nocturne",
    vibe: "Melancholic",
    bpm: 72,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "demo-2",
    title: "Tokyo Rain",
    vibe: "Lo-fi",
    bpm: 88,
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "demo-3",
    title: "Wilderness Dream",
    vibe: "Ethereal",
    bpm: 105,
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export function GalleryScreen() {
  const router = useRouter();
  const t = useTranslator();
  const [songs, setSongs] = useState<SongWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("newest");

  // Use demo songs when user has no real songs
  const displaySongs = songs.length > 0 ? songs : DEMO_SONGS;
  const isShowingDemo = songs.length === 0;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
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
    // If demo song, go to home to start humming
    if (song.id.startsWith("demo-")) {
      router.push("/");
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

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      {/* Activity heatmap — fills the top */}
      <div
        className="relative z-10 px-6 md:px-12 max-w-7xl mx-auto"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 48px)" }}
      >
        {!isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            <ActivityHeatmap
              dates={displaySongs.map((s) => s.createdAt)}
              songCount={songs.length}
              title={t("gallery.title")}
              recentSongs={sorted.slice(0, 3)}
              onSongClick={(id) => {
                const song = displaySongs.find((s) => s.id === id);
                if (song) handleSongClick(song);
              }}
            />
          </motion.div>
        )}
      </div>

      {/* Music note animation — always visible between heatmap and sort toggle */}
      {!isLoading && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex flex-col items-center px-6 md:px-12 py-8 md:py-12 max-w-2xl mx-auto text-center"
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
        <div className="relative z-10 px-6 md:px-12 max-w-7xl mx-auto flex justify-end pb-6 md:pb-8">
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

      {/* Loading skeletons — grid layout */}
      {isLoading && (
        <div className="relative z-10 px-6 md:px-12 max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5 xl:gap-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square rounded-[20px] bg-gradient-to-br from-[#ECE5D6] via-[#F5F1EB] to-[#ECE5D6] animate-shimmer" />
                <div className="mt-2 h-3 w-2/3 rounded-full bg-[#ECE5D6]" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state — no longer shown, we show demo songs instead */}
      {/* {!isLoading && songs.length === 0 && <EmptyState t={t} router={router} />} */}

      {/* Song grid — 2-col mobile / 3-col tablet / 4-col desktop */}
      {!isLoading && displaySongs.length > 0 && (
        <div className="relative z-10 px-6 md:px-12 pb-32 max-w-7xl mx-auto">
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
                vibe={song.vibe}
                bpm={song.bpm}
                createdAt={song.createdAt}
                index={i}
                onClick={() => handleSongClick(song)}
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

function EmptyState({
  t,
  router,
}: {
  t: (k: string) => string;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative z-10 flex flex-col items-center px-6 md:px-12 pb-32 max-w-2xl mx-auto text-center"
    >
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        fill="none"
        className="mb-8 opacity-30"
      >
        <motion.circle
          initial={{ scale: 0.75, opacity: 0.05 }}
          animate={{ scale: 1, opacity: 0.35 }}
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

      <p className="font-serif-italic text-[#1A1A1A] text-[32px] leading-[1.2] md:text-[40px]">
        {t("gallery.empty.title") || "还没有歌"}
      </p>
      <p className="font-serif-italic text-[#6F6A63] text-[20px] mt-2 md:text-[24px]">
        {t("gallery.empty.title2") || "来哼第一首吧"}
      </p>
      <button
        onClick={() => router.push("/")}
        className="mm-btn-primary mt-10"
      >
        {t("gallery.empty.cta") || "开始哼唱"} →
      </button>
    </motion.div>
  );
}
