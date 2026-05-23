"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Mic } from "lucide-react";
import { memory } from "@eazo/sdk";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { useTranslator } from "@/lib/i18n";
import type { SongCard } from "@/modules/shared/types";

type SongWithMeta = SongCard & { bpm?: number; keySignature?: string };

const GRADIENT_MAP: Record<string, string> = {
  warm_particles: "linear-gradient(135deg, #F4C87A, #E9A06D 45%, #C9B6E4)",
  dust_room:      "linear-gradient(135deg, #FFF0D6, #A7B8C8 60%, #8B8680)",
  end_credits:    "linear-gradient(135deg, #22303A, #A7B8C8, #F7F3EA)",
  confetti_pulse: "linear-gradient(135deg, #E9A06D, #F7C5CC, #C9B6E4)",
  rain_glass:     "linear-gradient(135deg, #A7B8C8, #D8DDD8, #FFFDF8)",
  synth_glow:     "linear-gradient(135deg, #C9B6E4, #22303A, #E9A06D)",
};

/** Deterministic small rotation by index — gives the wall a hand-pinned feel
    without being random on every render. Range: -1.6°..+1.6°. */
function tiltFor(i: number): number {
  const seq = [-1.4, 1.2, -0.8, 1.6, -1.0, 0.6, -1.6, 1.0];
  return seq[i % seq.length] ?? 0;
}

function SongSticker({
  song,
  index,
  onClick,
}: {
  song: SongWithMeta;
  index: number;
  onClick: () => void;
}) {
  const gradient =
    (song.visualConfig as { posterBg?: string }).posterBg ??
    GRADIENT_MAP[song.visualConfig.preset] ??
    song.visualConfig.gradient ??
    "linear-gradient(135deg, #F4C87A, #E9A06D)";

  const initials = song.title
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const tilt = tiltFor(index);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88, y: 16, rotate: tilt * 1.6 }}
      animate={{ opacity: 1, scale: 1, y: 0, rotate: tilt }}
      exit={{ opacity: 0, scale: 0.88 }}
      transition={{ delay: index * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ rotate: 0, y: -4, scale: 1.02, transition: { duration: 0.28 } }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="flex flex-col items-center cursor-pointer"
    >
      <div
        className="relative rounded-[22px] overflow-hidden"
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          background: gradient,
          boxShadow:
            "0 0 0 6px rgba(255,255,255,0.96), 0 2px 6px rgba(34,48,58,0.06), 0 12px 32px rgba(34,48,58,0.14)",
        }}
      >
        {/* Paper grain */}
        <div
          className="absolute inset-0 opacity-[0.09] mix-blend-multiply pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundSize: "160px",
          }}
        />
        {/* Bottom darken */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
        {/* Centre initials — serif italic */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-serif-italic text-white/75 text-[44px] tracking-tight select-none"
            style={{ fontWeight: 500 }}
          >
            {initials}
          </span>
        </div>
        {/* Vibe label */}
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
          <span className="text-white/70 text-[10px] font-medium tracking-[0.22em] uppercase">
            {song.vibe}
          </span>
        </div>
      </div>

      {/* Caption — serif title, mute meta */}
      <div className="mt-3 w-full px-0.5">
        <p className="font-serif text-[#22303A] text-[15px] leading-tight font-medium truncate">
          {song.title}
        </p>
        <p className="text-[#8B8680] text-[11px] mt-1 tracking-[0.04em]">
          {song.bpm ?? "—"} BPM
          {song.duration ? ` · ${Math.round(song.duration)}s` : ""}
        </p>
      </div>
    </motion.div>
  );
}

function EmptyState() {
  const router = useRouter();
  const t = useTranslator();
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="flex flex-col items-center justify-center py-24 px-8 text-center"
    >
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6"
        style={{
          background: "linear-gradient(135deg, #F4C87A, #E9A06D)",
          boxShadow:
            "0 0 0 6px rgba(255,255,255,0.92), 0 6px 22px rgba(233,160,109,0.35)",
        }}
      >
        <Mic className="w-8 h-8 text-white" />
      </div>
      <p
        className="font-serif-italic text-[#22303A] text-[26px] mb-2 leading-tight"
        style={{ fontWeight: 500 }}
      >
        {t("gallery.empty.title")}
      </p>
      <p className="text-[#8B8680] text-sm leading-relaxed mb-8 max-w-[260px]">
        {t("gallery.empty.detail")}
      </p>
      <motion.button
        whileTap={{ scale: 0.95 }}
        whileHover={{ y: -2 }}
        onClick={() => router.push("/")}
        className="flex items-center gap-2 px-7 py-3 rounded-full bg-[#E9A06D] text-white text-sm font-medium"
        style={{ boxShadow: "0 6px 20px rgba(233,160,109,0.4)" }}
      >
        <Mic className="w-4 h-4" />
        {t("gallery.empty.cta")}
      </motion.button>
    </motion.div>
  );
}

export function GalleryScreen() {
  const router = useRouter();
  const t = useTranslator();
  const { songs, setSongs } = useMurmurStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/songs");
        if (res.ok) {
          const data = (await res.json()) as SongWithMeta[];
          setSongs(data);
        }
      } catch {
        /* fall back to local store */
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [setSongs]);

  const handleSongClick = (song: SongCard) => {
    memory
      .reportAction({
        content: `User opened song "${song.title}" from Gallery`,
        event_type: "navigate",
        page: "gallery",
        metadata: { type: "open_song", song_id: song.id },
      })
      .catch(() => {});
    router.push(`/song/${song.id}`);
  };

  return (
    <div className="min-h-svh bg-[#F7F3EA]">
      <div
        className="px-6 md:px-10 pb-8 max-w-6xl"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 44px)" }}
      >
        <p className="eyebrow mb-3">{t("gallery.eyebrow")}</p>
        <h1
          className="font-serif text-[#22303A] text-[40px] md:text-[52px] leading-none tracking-[-0.02em]"
          style={{ fontWeight: 600 }}
        >
          {t("gallery.title")}
        </h1>
        <p className="mt-3 text-[#8B8680] text-sm md:text-[15px] max-w-md leading-relaxed">
          {t("gallery.subtitle")}
        </p>
      </div>

      {isLoading && (
        <div className="px-6 md:px-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-7 max-w-6xl">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <div
                className="w-full aspect-square rounded-[22px] bg-[#EDE7DB] animate-pulse"
                style={{ boxShadow: "0 0 0 6px rgba(255,255,255,0.92)" }}
              />
              <div className="h-3 w-3/4 bg-[#EDE7DB] rounded animate-pulse" />
              <div className="h-2.5 w-1/2 bg-[#EDE7DB] rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && songs.length === 0 && <EmptyState />}

      {!isLoading && songs.length > 0 && (
        <div className="px-6 md:px-10 pb-28 max-w-6xl">
          <motion.div
            layout
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-7 md:gap-8"
          >
            <AnimatePresence mode="popLayout">
              {songs.map((song, i) => (
                <SongSticker
                  key={song.id}
                  song={song as SongWithMeta}
                  index={i}
                  onClick={() => handleSongClick(song)}
                />
              ))}
            </AnimatePresence>
          </motion.div>

          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: songs.length * 0.05 + 0.15 }}
            whileTap={{ scale: 0.96 }}
            whileHover={{ y: -2 }}
            onClick={() => router.push("/")}
            className="mt-10 w-full md:w-auto md:px-8 md:mx-auto md:flex flex items-center justify-center gap-2 h-14 rounded-full border-2 border-dashed border-[#D9D1BF] text-[#8B8680] text-sm hover:border-[#E9A06D] hover:text-[#E9A06D] transition-all"
          >
            <Plus className="w-4 h-4" />
            {t("gallery.new_hum")}
          </motion.button>
        </div>
      )}
    </div>
  );
}
