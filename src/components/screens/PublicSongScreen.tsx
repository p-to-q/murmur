"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pause, Play, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";
import { SongVisualCanvas } from "@/components/song-detail/song-visual-canvas";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import { copyTextToClipboard } from "@/lib/platform/clipboard";
import { fetchWithTimeout, withTimeout } from "@/lib/api/timeout";
import { displayVibeLabel } from "@/lib/music/display-vibe";
import type { VisualConfig } from "@/modules/shared/types";

type PublicSong = {
  id: string;
  title: string;
  vibe: string;
  vibeEn?: string;
  bpm: number;
  keySignature: string;
  duration: number;
  visibility: "unlisted" | "public";
  shareCode: string;
  mp3DataUrl?: string | null;
  mp3Url?: string | null;
  visualConfig: VisualConfig;
  tags: string[];
  createdAt: string;
};

export function PublicSongScreen({ shareCode }: { shareCode: string }) {
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const [song, setSong] = useState<PublicSong | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStartingAudio, setIsStartingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchWithTimeout(
          `/api/public/songs/${encodeURIComponent(shareCode)}`,
          {},
          10_000,
        );
        if (!res.ok) {
          if (active) setSong(null);
          return;
        }
        const data = (await res.json()) as PublicSong;
        if (active) setSong(data);
      } catch {
        if (active) setSong(null);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [shareCode]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    const audioSrc = song?.mp3DataUrl || song?.mp3Url || null;
    const el = audioRef.current;
    if (!el) return;
    if (!audioSrc || el.src !== new URL(audioSrc, window.location.href).href) {
      el.pause();
      audioRef.current = null;
      setIsPlaying(false);
      setIsStartingAudio(false);
    }
  }, [song?.mp3DataUrl, song?.mp3Url]);

  const gradient = useMemo(() => {
    if (!song) return "linear-gradient(135deg, #FF8A5C, #FF5924)";
    return (
      (song.visualConfig as { posterBg?: string }).posterBg ??
      song.visualConfig.gradient ??
      "linear-gradient(135deg, #FF8A5C, #FF5924)"
    );
  }, [song]);

  const durationLabel = useMemo(() => {
    const seconds = Math.round(song?.duration ?? 0);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }, [song?.duration]);

  const togglePlay = useCallback(async () => {
    if (!song) return;
    const audioSrc = song.mp3DataUrl || song.mp3Url;
    if (!audioSrc) {
      toast(t("public_song.no_audio") || "This song is still missing its audio.");
      return;
    }

    let el = audioRef.current;
    if (!el) {
      el = new Audio(audioSrc);
      el.preload = "auto";
      el.addEventListener("ended", () => setIsPlaying(false));
      el.addEventListener("pause", () => setIsPlaying(false));
      el.addEventListener("play", () => setIsPlaying(true));
      audioRef.current = el;
    }

    if (el.paused) {
      if (isStartingAudio) return;
      setIsStartingAudio(true);
      try {
        await withTimeout(el.play(), 8_000, "Public song playback timed out");
      } catch (error) {
        console.warn("[PublicSong] playback failed:", error);
        el.pause();
        setIsPlaying(false);
        toast.error(t("public_song.play_failed") || "Couldn't start audio. Please try again.");
      } finally {
        setIsStartingAudio(false);
      }
    } else {
      el.pause();
    }
  }, [isStartingAudio, song, t]);

  const copyCurrentLink = useCallback(async () => {
    const ok = await copyTextToClipboard(window.location.href);
    if (ok) {
      toast.success(t("public_song.link_copied") || "Link copied");
    } else {
      toast.error(t("public_song.link_copy_failed") || "Couldn't copy that link");
    }
  }, [t]);

  if (isLoading) return <GlobalLoadingIndicator />;

  if (!song) {
    return (
      <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
        <PageBackdrop variant="soft" />
        <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
          <p className="eyebrow mb-3 text-[#FF8A5C]">
            {t("public_song.not_found.eyebrow") || "MISSING"}
          </p>
          <h1 className="hero-serif text-[32px] leading-tight text-[#1A1A1A] md:text-[48px]">
            {t("public_song.not_found") || "This shared song is no longer here."}
          </h1>
          <button onClick={() => router.push("/")} className="mm-btn-primary mt-8">
            {t("public_song.create_cta") || "Make your own"}
          </button>
        </div>
      </div>
    );
  }

  const audioReady = Boolean(song.mp3DataUrl || song.mp3Url);
  const titleClassName = titleFontClass(song.title);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />
      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-5xl flex-col px-5 pb-14 pt-10 md:px-10 md:pt-16">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="grid flex-1 items-center gap-8 md:grid-cols-[1.05fr_0.95fr]"
        >
          <section className="order-2 md:order-1">
            <p className="eyebrow text-[#FF8A5C]">
              {t("public_song.eyebrow") || "A MURMUR SONG"}
            </p>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[#6F6A63]">
              {t("public_song.body") ||
                "Someone hummed this into Murmur. Press play, then make one from your own melody."}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
              <span>{displayVibeLabel(song.vibe, song.tags, lang)}</span>
              <span className="text-[#D2C9B6]">·</span>
              <span className="tabular-nums">{song.bpm} BPM</span>
              <span className="text-[#D2C9B6]">·</span>
              <span>{song.keySignature}</span>
              <span className="text-[#D2C9B6]">·</span>
              <span className="tabular-nums">{durationLabel}</span>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button
                onClick={togglePlay}
                disabled={!audioReady || isStartingAudio}
                className="inline-flex h-12 items-center gap-3 rounded-full bg-[#1A1A1A] px-5 text-[14px] text-white transition-colors hover:bg-[#333] disabled:opacity-45"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" fill="white" />
                ) : (
                  <Play className="h-4 w-4" fill="white" />
                )}
                {isStartingAudio
                  ? t("public_song.loading_audio") || "Starting…"
                  : isPlaying
                  ? t("public_song.pause") || "Pause"
                  : t("public_song.play") || "Play"}
              </button>
              <button
                onClick={() => router.push("/")}
                className="mm-btn-primary inline-flex h-12 items-center gap-2 px-5"
              >
                <Sparkles className="h-4 w-4" />
                {t("public_song.create_cta") || "Make your own"}
              </button>
              <button
                onClick={copyCurrentLink}
                className="inline-flex h-12 items-center gap-2 rounded-full border border-[#E5DDD0] bg-white/70 px-5 text-[14px] text-[#1A1A1A] transition-colors hover:bg-white"
              >
                <Copy className="h-4 w-4" />
                {t("public_song.copy_link") || "Copy link"}
              </button>
            </div>
          </section>

          <motion.button
            type="button"
            onClick={togglePlay}
            disabled={!audioReady || isStartingAudio}
            whileTap={audioReady ? { scale: 0.98 } : undefined}
            className="order-1 relative overflow-hidden rounded-[28px] border border-white/45 shadow-[0_28px_70px_rgba(26,26,26,0.13)] disabled:cursor-default md:order-2"
            style={{ aspectRatio: "4/5" }}
          >
            <SongVisualCanvas gradient={gradient} artwork={song.visualConfig.artwork} />
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/55 via-black/18 to-transparent" />
            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between gap-4 text-left">
              <div>
                <p className="text-[10px] uppercase tracking-[0.32em] text-white/65">
                  MURMUR
                </p>
                <p className={`${titleClassName} mt-2 text-[34px] leading-none text-white md:text-[40px]`}>
                  {song.title}
                </p>
              </div>
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/60 bg-white/20 backdrop-blur-md">
                {isPlaying ? (
                  <Pause className="h-5 w-5 text-white" fill="white" />
                ) : (
                  <Play className="ml-0.5 h-5 w-5 text-white" fill="white" />
                )}
              </span>
            </div>
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
}

function titleFontClass(title: string): string {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(title)
    ? "hero-serif-italic"
    : "hero-serif-latin-italic";
}
