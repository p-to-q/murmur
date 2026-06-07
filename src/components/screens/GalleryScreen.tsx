"use client";

/**
 * GalleryScreen v2 — 极致美学版
 *
 * 特点：
 * - 瀑布流布局（Masonry）
 * - 随机生成封面（每次都不同）
 * - Capwords 风格白边标签
 * - 酷炫弹性动画 + 3D Hover
 * - 懒加载 + Shimmer 骨架屏
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Masonry from "react-masonry-css";
import { memory } from "@/lib/platform/memory";

import { useTranslator } from "@/lib/i18n";
import type { SongCard as SongCardType } from "@/modules/shared/types";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { SongCard } from "@/components/gallery/SongCard";

type SongWithMeta = SongCardType & { bpm?: number; keySignature?: string };
type SortMode = "newest" | "alpha";

export function GalleryScreen() {
  const router = useRouter();
  const t = useTranslator();
  const [songs, setSongs] = useState<SongWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("newest");

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
    const list = [...songs];
    if (sort === "alpha") {
      return list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [songs, sort]);

  const handleSongClick = (song: SongCardType) => {
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

  // Masonry 响应式列数
  const breakpointCols = {
    default: 5,
    1536: 4,
    1280: 3,
    768: 2,
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      {/* Header */}
      <div
        className="relative z-10 px-6 md:px-12 pb-8 md:pb-12 max-w-7xl mx-auto"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 56px)" }}
      >
        <div className="flex items-start justify-between gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="min-w-0 flex-1"
          >
            <h1 className="hero-serif-italic text-[#1A1A1A] text-[40px] leading-[1.05] md:text-[64px]">
              {t("gallery.title") || "Things you hummed"}
            </h1>
            <p className="font-serif-italic mt-2 max-w-[32rem] text-[13px] leading-[1.6] text-[#6F6A63] md:text-[14px]">
              {t("gallery.subtitle") || "A quiet shelf of melodies."}
            </p>
          </motion.div>

          {songs.length > 1 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <SortToggle sort={sort} onChange={setSort} t={t} />
            </motion.div>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="relative z-10 px-6 md:px-12 max-w-7xl mx-auto">
          <Masonry
            breakpointCols={breakpointCols}
            className="flex -ml-6 w-auto"
            columnClassName="pl-6 bg-clip-padding"
          >
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="mb-8">
                <div className="aspect-square rounded-[16px] bg-gradient-to-r from-[#ECE5D6] via-[#F5F1EB] to-[#ECE5D6] animate-shimmer" />
                <div className="mt-3 mx-auto w-3/4 h-10 rounded-[10px] bg-[#ECE5D6]" />
              </div>
            ))}
          </Masonry>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && songs.length === 0 && <EmptyState t={t} router={router} />}

      {/* Masonry Grid */}
      {!isLoading && songs.length > 0 && (
        <div className="relative z-10 px-6 md:px-12 pb-32 max-w-7xl mx-auto">
          <Masonry
            breakpointCols={breakpointCols}
            className="flex -ml-6 w-auto"
            columnClassName="pl-6 bg-clip-padding"
          >
            {sorted.map((song, i) => (
              <div key={song.id} className="mb-8">
                <SongCard
                  id={song.id}
                  title={song.title}
                  vibe={song.vibe}
                  bpm={song.bpm}
                  createdAt={song.createdAt}
                  index={i}
                  onClick={() => handleSongClick(song)}
                />
              </div>
            ))}
          </Masonry>

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
              ↻ {t("gallery.new_hum") || "Hum another one"}
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}

/* Components */

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
      {/* 空白音符 SVG */}
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        fill="none"
        className="mb-8 opacity-30"
      >
        <motion.circle
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.3 }}
          transition={{
            duration: 2,
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
            duration: 1.5,
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
