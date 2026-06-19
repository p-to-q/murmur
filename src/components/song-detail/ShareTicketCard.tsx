"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Spinner } from "@/components/ui/spinner";
import { X, Download, Play, Pause } from "lucide-react";
import type { VisualArtwork } from "@/modules/shared/types";
import { SongVisualCanvas } from "@/components/song-detail/song-visual-canvas";

interface ShareTicketCardProps {
  songId: string;
  title: string;
  gradient: string;
  artwork?: VisualArtwork;
  durationSec: number;
  bpm: number;
  keySignature: string;
  createdAt: string;
  audioSrc?: string | null;
  open: boolean;
  onClose: () => void;
  onDownloadVideo?: () => void;
  videoExporting?: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTime(sec: number): string {
  return `${pad2(Math.floor(sec / 60))}:${pad2(Math.round(sec % 60))}`;
}

const ticketSerifStyle = {
  fontFamily: "var(--font-instrument-serif), var(--murmur-font-chinese)",
  fontWeight: 400,
  letterSpacing: 0,
};

export function ShareTicketCard({
  songId,
  title,
  gradient,
  artwork,
  durationSec,
  bpm,
  keySignature,
  createdAt,
  audioSrc,
  open,
  onClose,
  onDownloadVideo,
  videoExporting = false,
}: ShareTicketCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const year = new Date(createdAt).getFullYear();
  const progress = durationSec > 0 ? currentTime / durationSec : 0;

  useEffect(() => {
    if (open) return;
    audioRef.current?.pause();
    const resetTimer = window.setTimeout(() => {
      setPlaying(false);
      setCurrentTime(0);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [open]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioSrc) return;
    let el = audioRef.current;
    if (!el) {
      el = new Audio(audioSrc);
      el.addEventListener("ended", () => { setPlaying(false); setCurrentTime(0); });
      el.addEventListener("pause", () => setPlaying(false));
      el.addEventListener("play", () => setPlaying(true));
      el.addEventListener("timeupdate", () => setCurrentTime(el!.currentTime));
      audioRef.current = el;
    }
    if (el.paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [audioSrc]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/40 backdrop-blur-md px-3"
          style={{
            paddingTop: "max(env(safe-area-inset-top, 0px), 12px)",
            paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)",
          }}
          onClick={onClose}
        >
          {/* Top-right: download + close */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ delay: 0.08, duration: 0.3 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-4 flex items-center gap-3"
            style={{ top: "max(env(safe-area-inset-top, 0px), 16px)" }}
          >
            {onDownloadVideo && (
              <button
                onClick={onDownloadVideo}
                disabled={videoExporting}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2A2A2A] text-white/90 transition-colors hover:bg-[#3A3A3A] active:scale-95 disabled:opacity-50"
                aria-label="Download video"
              >
                {videoExporting ? (
                  <Spinner size="sm" variant="light" />
                ) : (
                  <Download className="h-[18px] w-[18px]" strokeWidth={2.2} />
                )}
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2A2A2A] text-white/80 transition-colors hover:bg-[#3A3A3A] active:scale-95"
              aria-label="Close"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </button>
          </motion.div>

          {/* Ticket card */}
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.92 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[420px]"
            style={{ maxHeight: "calc(100vh - 120px)" }}
          >
            <div
              ref={cardRef}
              className="relative overflow-hidden rounded-[28px]"
              style={{
                aspectRatio: "9/16",
                WebkitMaskImage:
                  "radial-gradient(circle 20px at 0 calc(100% - 100px), transparent 19px, #000 20px), radial-gradient(circle 20px at 100% calc(100% - 100px), transparent 19px, #000 20px)",
                WebkitMaskComposite: "source-in",
                maskImage:
                  "radial-gradient(circle 20px at 0 calc(100% - 100px), transparent 19px, #000 20px), radial-gradient(circle 20px at 100% calc(100% - 100px), transparent 19px, #000 20px)",
                maskComposite: "intersect",
              }}
            >
              <div className="absolute inset-0">
                <SongVisualCanvas gradient={gradient} artwork={artwork} />
              </div>

              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-1/4"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 100%)",
                }}
              />

              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5"
                style={{
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.20) 50%, rgba(0,0,0,0) 100%)",
                }}
              />

              <div className="absolute inset-x-0 bottom-0 pb-7">
                <div className="px-7">
                  <h2
                    className="hero-serif text-white leading-[0.95]"
                    style={{
                      ...ticketSerifStyle,
                      fontSize: "clamp(38px, 10vw, 52px)",
                    }}
                  >
                    {title}
                  </h2>
                </div>

                <div className="relative mt-5">
                  <div
                    className="border-t border-dashed"
                    style={{ borderColor: "rgba(255,255,255,0.42)" }}
                  />
                </div>

                <div className="mt-4 flex items-end justify-between px-7">
                  <TicketField label="time" value={String(year)} />
                  <TicketField label="bpm" value={String(bpm)} />
                  <TicketField label="key" value={keySignature} />
                </div>

                {/* Mini player */}
                {audioSrc && (
                  <div className="mt-5 flex items-center gap-3 px-7">
                    <button
                      onClick={togglePlay}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/15 backdrop-blur-sm active:scale-95"
                    >
                      {playing ? (
                        <Pause className="h-3.5 w-3.5 text-white" fill="white" />
                      ) : (
                        <Play className="ml-0.5 h-3.5 w-3.5 text-white" fill="white" />
                      )}
                    </button>
                    <div className="flex flex-1 items-center gap-2">
                      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/20">
                        <div
                          className="h-full rounded-full bg-white/70 transition-[width] duration-200"
                          style={{ width: `${Math.min(progress * 100, 100)}%` }}
                        />
                      </div>
                      <span
                        className="shrink-0 text-[11px] tabular-nums text-white/50"
                        style={ticketSerifStyle}
                      >
                        {formatTime(durationSec)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TicketField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start">
      <span
        className="text-[11px] uppercase leading-none tracking-[0.18em]"
        style={{ ...ticketSerifStyle, color: "rgba(255,255,255,0.55)" }}
      >
        {label}
      </span>
      <span
        className="hero-serif mt-1.5 tabular-nums leading-none"
        style={{
          ...ticketSerifStyle,
          fontSize: "clamp(28px, 7vw, 38px)",
          color: "rgba(255,255,255,0.80)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
