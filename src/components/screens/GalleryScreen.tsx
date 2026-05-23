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
  warm_particles: "linear-gradient(135deg, #F4C87A, #FF8A5C 45%, #C9B6E4)",
  dust_room:      "linear-gradient(135deg, #FFF0D6, #A7B8C8 60%, #8C8780)",
  end_credits:    "linear-gradient(135deg, #1A1A1A, #A7B8C8, #F5F1EB)",
  confetti_pulse: "linear-gradient(135deg, #FF5924, #F7C5CC, #C9B6E4)",
  rain_glass:     "linear-gradient(135deg, #A7B8C8, #D8DDD8, #FFFEFB)",
  synth_glow:     "linear-gradient(135deg, #C9B6E4, #1A1A1A, #FF5924)",
};

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
    "linear-gradient(135deg, #F4C87A, #FF5924)";

  const initials = song.title
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ delay: index * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.22 } }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="flex flex-col cursor-pointer group"
    >
      {/* Poster — straight, tight radius, very soft shadow */}
      <div
        className="relative rounded-[12px] overflow-hidden"
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          background: gradient,
          boxShadow:
            "0 1px 3px rgba(26,26,26,0.06), 0 12px 28px rgba(26,26,26,0.10)",
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.10] mix-blend-multiply pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundSize: "160px",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/35 to-transparent pointer-events-none" />
        {/* Centre initials — large serif italic */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-serif-italic text-white/85 text-[52px] leading-none tracking-tight select-none">
            {initials}
          </span>
        </div>
        {/* Vibe label */}
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
          <span className="text-white/75 text-[10px] tracking-[0.26em] uppercase">
            {song.vibe}
          </span>
        </div>
      </div>

      {/* Caption */}
      <div className="mt-3 px-0.5">
        <p className="font-serif text-[#1A1A1A] text-[17px] leading-tight truncate group-hover:underline-mm">
          {song.title}
        </p>
        <p className="text-[#8C8780] text-[11px] mt-1 tracking-[0.06em]">
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
        className="w-20 h-20 rounded-full flex items-center justify-center mb-7"
        style={{
          background: "linear-gradient(135deg, #FF8A5C, #FF5924)",
          boxShadow: "0 8px 24px rgba(255,89,36,0.35)",
        }}
      >
        <Mic className="w-8 h-8 text-white" />
      </div>
      <p className="font-serif-italic text-[#1A1A1A] text-[32px] mb-3 leading-[1.05]">
        {t("gallery.empty.title")}
      </p>
      <p className="text-[#8C8780] text-[15px] leading-relaxed mb-8 max-w-[300px]">
        {t("gallery.empty.detail")}
      </p>
      <button onClick={() => router.push("/")} className="mm-btn-primary">
        <Mic className="w-4 h-4" />
        {t("gallery.empty.cta")}
      </button>
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
    <div className="min-h-svh bg-[#F5F1EB]">
      <div
        className="px-6 md:px-12 pb-10 md:pb-14 max-w-6xl"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 56px)" }}
      >
        <p className="eyebrow mb-4">{t("gallery.eyebrow")}</p>
        <h1 className="hero-serif text-[#1A1A1A] text-[48px] md:text-[76px]">
          {t("gallery.title")}
        </h1>
        <p className="mt-4 text-[#3A3A3A] text-[15px] md:text-[17px] max-w-[480px] leading-[1.5]">
          {t("gallery.subtitle")}
        </p>
      </div>

      {isLoading && (
        <div className="px-6 md:px-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8 max-w-6xl">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col gap-2.5">
              <div className="w-full aspect-square rounded-[12px] bg-[#ECE5D6] animate-pulse" />
              <div className="h-3 w-3/4 bg-[#ECE5D6] rounded animate-pulse" />
              <div className="h-2.5 w-1/2 bg-[#ECE5D6] rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && songs.length === 0 && <EmptyState />}

      {!isLoading && songs.length > 0 && (
        <div className="px-6 md:px-12 pb-28 max-w-6xl">
          <motion.div
            layout
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8"
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

          <div className="mt-12 flex justify-center">
            <button
              onClick={() => router.push("/")}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-[#8C8780] text-[13px] tracking-[0.04em] border border-dashed border-[#D2C9B6] rounded-full hover:border-[#FF5924] hover:text-[#FF5924] transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("gallery.new_hum")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
