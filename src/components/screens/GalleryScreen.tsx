"use client";

/**
 * GalleryScreen — Compose v2 *remember* moment.
 *
 * Specced in docs/page-redesign.md §7.
 *
 * Keeps the word-card MyMind grid, replaces same-y-looking initials covers
 * with deterministic SongCoverArt (per-song fingerprint), adds a quiet
 * newest/A-Z sort affordance, polishes empty state copy.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { memory } from "@/lib/platform/memory";

import { useTranslator } from "@/lib/i18n";
import { getLineageLabel } from "@/modules/music/lineage";
import { getMelodyOriginCopy } from "@/modules/music/melody-origin";
import type { SongCard } from "@/modules/shared/types";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { SongCoverArt } from "@/components/song-detail/song-cover-art";

type SongWithMeta = SongCard & { bpm?: number; keySignature?: string };
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

  const handleSongClick = (song: SongCard) => {
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

      {/* ── Header ───────────────────────────────────────────────── */}
      <div
        className="relative z-10 px-6 md:px-12 pb-10 md:pb-14 max-w-6xl"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 56px)" }}
      >
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow text-[#FF8A5C]">
              {songs.length === 0
                ? (t("gallery.eyebrow.empty") || "YOUR SHELF")
                : (t("gallery.eyebrow") || `${songs.length} ${songs.length === 1 ? "SONG" : "SONGS"}`)}
            </p>
            <h1 className="hero-serif-italic mt-3 text-[#1A1A1A] text-[48px] leading-[1.02] md:text-[76px]">
              {t("gallery.title") || "Things you hummed"}
            </h1>
            <p className="font-serif-italic mt-3 max-w-[28rem] text-[14px] leading-[1.55] text-[#6F6A63] md:text-[15px]">
              {t("gallery.subtitle") || "A quiet shelf of melodies."}
            </p>
          </div>

          {songs.length > 1 && (
            <SortToggle sort={sort} onChange={setSort} t={t} />
          )}
        </div>
      </div>

      {/* ── Loading ──────────────────────────────────────────────── */}
      {isLoading && (
        <div className="relative z-10 px-6 md:px-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-10 md:gap-x-8 md:gap-y-12 max-w-6xl">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="w-[120px] h-[120px] rounded-[14px] bg-[#ECE5D6] animate-pulse" />
              <div className="h-6 w-3/4 bg-[#ECE5D6] rounded animate-pulse" />
              <div className="h-2.5 w-1/2 bg-[#ECE5D6] rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────── */}
      {!isLoading && songs.length === 0 && <EmptyState t={t} router={router} />}

      {/* ── Grid ─────────────────────────────────────────────────── */}
      {!isLoading && songs.length > 0 && (
        <div className="relative z-10 px-6 md:px-12 pb-32 max-w-6xl">
          <motion.div
            layout
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-10 md:gap-x-8 md:gap-y-12"
          >
            <AnimatePresence mode="popLayout">
              {sorted.map((song, i) => (
                <SongTile
                  key={song.id}
                  song={song}
                  index={i}
                  t={t}
                  onClick={() => handleSongClick(song)}
                />
              ))}
            </AnimatePresence>
          </motion.div>

          <div className="mt-14 flex justify-center">
            <button
              onClick={() => router.push("/")}
              className="font-serif-italic text-[15px] text-[#FF5924] hover:text-[#D9421A] underline-mm transition-colors"
            >
              ↻ {t("gallery.new_hum") || "Hum another one"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function SongTile({
  song,
  index,
  onClick,
  t,
}: {
  song: SongWithMeta;
  index: number;
  onClick: () => void;
  t: (key: string) => string;
}) {
  const gradient =
    (song.visualConfig as { posterBg?: string }).posterBg ??
    song.visualConfig.gradient ??
    "linear-gradient(135deg, #F4C87A, #FF5924)";
  const initials = song.title
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2);
  const melodyOrigin = getMelodyOriginCopy(song.sourceMelodyKind ?? "corrected", t);
  const lineageLabel = getLineageLabel(song, (key) => {
    if (key === "lineage.original") {
      return t("gallery.tile.original") || "Original";
    }
    if (key === "lineage.branch_n") {
      return t("gallery.tile.branch_n") || "Branch {n}";
    }
    return t(key);
  });

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        delay: index * 0.03,
        duration: 0.45,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="group flex w-full flex-col items-start text-left"
    >
      <div
        className="relative overflow-hidden rounded-[14px]"
        style={{
          width: "120px",
          height: "120px",
          boxShadow:
            "0 1px 3px rgba(26,26,26,0.06), 0 10px 28px rgba(26,26,26,0.10)",
        }}
      >
        <SongCoverArt
          gradient={gradient}
          seed={song.id}
          bpm={song.bpm}
          keySig={song.keySignature}
          initials={initials}
          className="absolute inset-0"
        />
      </div>

      <p className="mt-4 font-serif-italic text-[#1A1A1A] text-[26px] leading-[1.04] tracking-[-0.01em] group-hover:text-[#FF5924] transition-colors line-clamp-2 md:text-[30px]">
        {song.title}
      </p>
      <p className="mt-2 text-[10px] uppercase tracking-[0.22em] text-[#B7AEA1] tabular-nums">
        {song.vibe}
        {song.bpm ? ` · ${song.bpm} BPM` : ""}
      </p>
      <p className="mt-2 text-[11px] leading-[1.45] text-[#8C8780]">
        {melodyOrigin.label} · {lineageLabel}
      </p>
    </motion.button>
  );
}

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
    <div className="flex shrink-0 items-center gap-2 text-[11px] tracking-[0.04em]">
      <button
        onClick={() => onChange("newest")}
        className={`transition-colors ${sort === "newest" ? "text-[#1A1A1A]" : "text-[#8C8780] hover:text-[#1A1A1A]"}`}
      >
        ↑ {t("gallery.sort.newest") || "newest"}
      </button>
      <span className="text-[#D2C9B6]">·</span>
      <button
        onClick={() => onChange("alpha")}
        className={`transition-colors ${sort === "alpha" ? "text-[#1A1A1A]" : "text-[#8C8780] hover:text-[#1A1A1A]"}`}
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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="relative z-10 flex flex-col items-start px-6 md:px-12 pb-32 max-w-3xl"
    >
      <p className="font-serif-italic text-[#1A1A1A] text-[28px] leading-[1.2] md:text-[36px]">
        {t("gallery.empty.title") || "Nothing here yet."}
      </p>
      <p className="font-serif-italic text-[#6F6A63] text-[20px] mt-1 md:text-[26px]">
        {t("gallery.empty.title2") || "Hum your first one."}
      </p>
      <button
        onClick={() => router.push("/")}
        className="mm-btn-primary mt-8"
      >
        {t("gallery.empty.cta") || "Start humming"} →
      </button>
    </motion.div>
  );
}
