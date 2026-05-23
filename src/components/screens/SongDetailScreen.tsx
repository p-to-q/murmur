"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Pause, Play, Sliders } from "lucide-react";
import { toast } from "sonner";
import { memory } from "@eazo/sdk";

import type { SongCard } from "@/modules/shared/types";
import { useTranslator } from "@/lib/i18n";
import { getPlayer, startAudioContext } from "@/lib/music/tone-player";
import { SongVisualCanvas } from "@/components/song-detail/song-visual-canvas";
import { ShareActions } from "@/components/song-detail/share-actions";

type Song = SongCard & {
  mp3DataUrl?: string | null;
  bpm?: number;
  keySignature?: string;
};

export function SongDetailScreen({ songId }: { songId: string }) {
  // Song detail is the "artifact" screen: playback, identity, live visual
  // preview, and export all meet here so the saved song feels like a finished
  // object rather than a debug record of generation.
  const router = useRouter();
  const t = useTranslator();
  const [song, setSong] = useState<Song | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── Load song ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/songs/${songId}`);
        if (res.ok) {
          const data = (await res.json()) as Song;
          setSong(data);
          memory
            .reportAction({
              content: `User viewed song detail: "${data.title}"`,
              event_type: "navigate",
              page: "song-detail",
              metadata: { type: "view_song", song_id: data.id },
            })
            .catch(() => {});
        }
      } catch (err) {
        console.warn("[SongDetail] load error:", err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [songId]);

  // ── Cleanup on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      getPlayer().stop().catch(() => {});
    };
  }, []);

  // ── Playback ──────────────────────────────────────────────────────
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
        .filter((p) => !isNaN(p) && p > 20 && p < 120);
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
      toast.error(t("song.export.err"));
      setIsPlaying(false);
    }
  }, [song, isPlaying, t]);

  const handlePlay = useCallback(async () => {
    if (!song) return;

    // Prefer the rendered MP3/WAV if we have one (faster, deterministic).
    if (song.mp3DataUrl) {
      let el = audioRef.current;
      if (!el) {
        el = new Audio(song.mp3DataUrl);
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

  // ── Render guards ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-svh bg-[#F5F1EB] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#FF5924] border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!song) {
    return (
      <div className="min-h-svh bg-[#F5F1EB] flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-[#8C8780]">{t("song.not_found")}</p>
        <button
          onClick={() => router.push("/gallery")}
          className="text-[#FF5924] text-sm underline"
        >
          {t("song.back_to_gallery")}
        </button>
      </div>
    );
  }

  const gradient =
    (song.visualConfig as { posterBg?: string }).posterBg ??
    song.visualConfig.gradient ??
    "linear-gradient(135deg, #FF8A5C, #FF5924)";
  const bpm = song.bpm ?? 80;
  const keySig = song.keySignature ?? "C";

  return (
    <div className="min-h-svh bg-[#F5F1EB] flex flex-col">
      {/* Header — safe-area-aware */}
      <div
        className="flex items-center justify-between px-5 pb-4"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 rounded-full bg-[#EFE8DA] flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-[#1A1A1A]" />
        </button>
        <div />
        <button
          onClick={() => router.push("/studio")}
          aria-label="Studio"
          className="w-9 h-9 rounded-full bg-[#EFE8DA] flex items-center justify-center"
        >
          <Sliders className="w-4 h-4 text-[#8C8780]" />
        </button>
      </div>

      {/* Hero visual */}
      <div
        id="song-visual"
        className="mx-5 rounded-3xl overflow-hidden relative"
        style={{ height: 280 }}
      >
        <SongVisualCanvas gradient={gradient} isPlaying={isPlaying} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent pointer-events-none" />
        <div className="absolute bottom-6 left-6 right-6 pointer-events-none">
          <p className="text-white/65 text-[10px] tracking-[0.28em] uppercase mb-2">
            {song.vibe}
          </p>
          <h2
            className="font-serif text-white text-[30px] leading-[1.05]"
            style={{ letterSpacing: "-0.018em" }}
          >
            {song.title}
          </h2>
        </div>
        <button
          onClick={() => {
            startAudioContext();
            handlePlay();
          }}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="absolute inset-0 flex items-center justify-center"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={isPlaying ? "pause" : "play"}
              initial={{ scale: 0.75, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.75, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-16 h-16 rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center border border-white/30"
            >
              {isPlaying ? (
                <Pause className="w-7 h-7 text-white" fill="white" />
              ) : (
                <Play className="w-7 h-7 text-white ml-0.5" fill="white" />
              )}
            </motion.div>
          </AnimatePresence>
        </button>
      </div>
      <div className="px-5 mt-3">
        <div className="rounded-2xl border border-[#E5DDD0] bg-[#FFFEFB]/88 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[#1A1A1A] text-sm font-medium">{t("song.preview.live")}</p>
              <p className="mt-1 text-[#8C8780] text-xs leading-5">
                {t("song.preview.live_desc")}
              </p>
            </div>
            <div className="shrink-0 rounded-full bg-[#EFE8DA] px-3 py-1 text-[10px] font-medium tracking-[0.12em] text-[#8C8780] uppercase">
              {t("song.preview.live_badge")}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-[#B8B0A2]">
            <span>{t("song.preview.step_preview")}</span>
            <span>→</span>
            <span>{t("song.preview.step_export")}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 mt-6 space-y-4 pb-24">
        <MetaCard
          title={song.title}
          vibe={song.vibe}
          bpm={bpm}
          keySig={keySig}
          duration={song.duration ?? 0}
          createdAt={song.createdAt}
          translator={t}
        />

        <div
          className="bg-[#FFFEFB] rounded-2xl p-5"
          style={{ boxShadow: "0 2px 12px rgba(26, 26, 26,0.06)" }}
        >
          <p className="text-[#8C8780] text-xs font-medium tracking-wider uppercase mb-3">
            {t("song.arrangement")}
          </p>
          <div className="space-y-2.5">
            {(["melody", "chords", "strings", "drums", "bass"] as const).map(
              (track) => {
                const tr = song.arrangementState[track];
                return (
                  <div key={track} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-1.5 h-5 rounded-full"
                        style={{ background: tr.enabled ? "#FF5924" : "#E5DDD0" }}
                      />
                      <div>
                        <p className="text-[#1A1A1A] text-xs font-medium">
                          {t(`track.${track}`)}
                        </p>
                        <p className="text-[#8C8780] text-[11px]">{tr.instrument}</p>
                      </div>
                    </div>
                    <div className="w-20 h-1 bg-[#E5DDD0] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#FF5924] rounded-full"
                        style={{ width: `${(tr.intensity ?? 0) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>

        <ShareActions song={song} />
      </div>
    </div>
  );
}

function MetaCard({
  title, vibe, bpm, keySig, duration, createdAt, translator,
}: {
  title: string;
  vibe: string;
  bpm: number;
  keySig: string;
  duration: number;
  createdAt: string;
  translator: (k: string) => string;
}) {
  return (
    <div
      className="bg-[#FFFEFB] rounded-2xl p-6"
      style={{ boxShadow: "0 2px 12px rgba(26, 26, 26,0.06)" }}
    >
      <h1
        className="font-serif text-[#1A1A1A] text-[24px] leading-tight mb-4"
        style={{ letterSpacing: "-0.012em" }}
      >
        {title}
      </h1>
      <div className="flex flex-wrap gap-2">
        <MetaBadge label={translator("song.meta.vibe")} value={vibe} />
        <MetaBadge label={translator("song.meta.bpm")} value={String(bpm)} />
        <MetaBadge label={translator("song.meta.key")} value={keySig} />
        <MetaBadge label={translator("song.meta.duration")} value={`${duration}s`} />
      </div>
      <p className="text-[#B8B0A2] text-[11px] mt-4 tracking-[0.06em]">
        {new Date(createdAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
    </div>
  );
}

function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-1.5 rounded-xl bg-[#EFE8DA] text-center">
      <p className="text-[#8C8780] text-[10px] font-medium uppercase">{label}</p>
      <p className="text-[#1A1A1A] text-sm font-semibold">{value}</p>
    </div>
  );
}
