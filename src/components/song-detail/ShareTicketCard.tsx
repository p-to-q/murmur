"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import {
  X,
  Heart,
  Share2,
  SkipBack,
  Pause,
  Play,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { usePlatformState } from "@/lib/platform/auth-client";
import { buildMeshGradient } from "@/components/song-detail/mesh-gradient";
import type { VisualArtwork } from "@/modules/shared/types";

interface ShareTicketCardProps {
  songId: string;
  title: string;
  gradient: string;
  artwork?: VisualArtwork;
  durationSec: number;
  bpm: number;
  keySignature: string;
  createdAt: string;
  mp3DataUrl?: string | null;
  open: boolean;
  onClose: () => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${pad2(m)}:${pad2(s)}`;
}

function avatarGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue1 = (h >>> 0) % 360;
  const hue2 = (hue1 + 40 + ((h >>> 8) % 60)) % 360;
  const sat = 35 + ((h >>> 16) % 25);
  return `linear-gradient(135deg, hsl(${hue1},${sat}%,72%) 0%, hsl(${hue2},${sat + 10}%,78%) 100%)`;
}

export function ShareTicketCard({
  songId,
  title,
  gradient,
  artwork,
  durationSec,
  bpm,
  keySignature,
  mp3DataUrl,
  open,
  onClose,
}: ShareTicketCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [liked, setLiked] = useState(false);

  const platformUser = usePlatformState((s) => s.auth.user);
  const { data: session } = useSession();
  const user = session?.user
    ? {
        name: session.user.name ?? null,
        id:
          ((session.user as Record<string, unknown>).id as string) ||
          "google-user",
      }
    : platformUser
      ? { name: platformUser.name ?? null, id: platformUser.id }
      : { name: null, id: "murmur" };

  const displayName = user.name || "Creator";
  const artworkPath = artwork?.backgroundImagePath ?? artwork?.imagePath;
  const bgStyle = useMemo(
    () => buildMeshGradient(gradient, artwork?.palette),
    [gradient, artwork?.palette],
  );

  const hasAudio = !!mp3DataUrl;

  /* ── Audio engine ────────────────────────────────────────────────── */

  useEffect(() => {
    if (!open || !mp3DataUrl) return;

    let el = audioRef.current;
    if (!el || el.getAttribute("data-src") !== mp3DataUrl) {
      el?.pause();
      el = new Audio(mp3DataUrl);
      el.preload = "auto";
      el.setAttribute("data-src", mp3DataUrl);
      audioRef.current = el;
    }

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };
    const onTime = () => {
      if (!el) return;
      const dur = el.duration || durationSec || 1;
      setProgress(el.currentTime / dur);
      setCurrentTime(el.currentTime);
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTime);

    return () => {
      el?.removeEventListener("play", onPlay);
      el?.removeEventListener("pause", onPause);
      el?.removeEventListener("ended", onEnded);
      el?.removeEventListener("timeupdate", onTime);
    };
  }, [open, mp3DataUrl, durationSec]);

  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      setPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    }
  }, [open]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  const skipBack = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = 0;
    setProgress(0);
    setCurrentTime(0);
  }, []);

  const seekTo = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      const el = audioRef.current;
      const bar = barRef.current;
      if (!el || !bar) return;
      const rect = bar.getBoundingClientRect();
      const cx = "touches" in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
      const ratio = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
      el.currentTime = ratio * (el.duration || durationSec);
    },
    [durationSec],
  );

  /* ── Save card as image ────────────────────────────────────────────── */

  const handleDownload = useCallback(async () => {
    const node = cardRef.current;
    if (!node) return;
    try {
      const mod = await import("html2canvas");
      const html2canvas =
        typeof (mod as Record<string, unknown>).default === "function"
          ? (mod as unknown as { default: typeof import("html2canvas")["default"] }).default
          : (mod as unknown as typeof import("html2canvas")["default"]);

      const sanitizeColors = (_doc: Document, clone: HTMLElement) => {
        const ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) return;
        const PROPS = [
          "color",
          "background-color",
          "border-color",
          "outline-color",
          "text-decoration-color",
          "fill",
          "stroke",
        ];
        clone.querySelectorAll("*").forEach((el) => {
          const cs = getComputedStyle(el);
          const s = (el as HTMLElement).style;
          for (const prop of PROPS) {
            const v = cs.getPropertyValue(prop);
            if (v && /okl(ab|ch)\(/.test(v)) {
              ctx.fillStyle = "#000";
              ctx.fillStyle = v;
              s.setProperty(prop, ctx.fillStyle);
            }
          }
          const bg = cs.getPropertyValue("background-image");
          if (bg && /okl(ab|ch)\(/.test(bg)) {
            s.setProperty("background-image", "none");
          }
        });
      };

      const canvas = await html2canvas(node, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        onclone: sanitizeColors,
      });

      let blob: Blob | null = null;
      try {
        blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/png", 0.95),
        );
      } catch {
        const fallback = await html2canvas(node, {
          backgroundColor: null,
          scale: 2,
          allowTaint: true,
          logging: false,
          onclone: sanitizeColors,
          ignoreElements: (el: Element) => el.tagName === "IMG",
        });
        blob = await new Promise<Blob | null>((resolve) =>
          fallback.toBlob((b) => resolve(b), "image/png", 0.95),
        );
      }

      if (!blob) {
        toast.error("Failed to capture card");
        return;
      }

      const slug = title.replace(/\s+/g, "-").toLowerCase();
      const file = new File([blob], `${slug}-card.png`, { type: "image/png" });

      if (
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title,
          text: `${title} — made with Murmur`,
          files: [file],
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug}-card.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        toast.success("Card saved");
      }
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") {
        console.error("[ShareTicketCard] capture failed:", e);
        toast.error("Save failed");
      }
    }
  }, [title]);

  const handleCopyLink = useCallback(() => {
    const url = `${window.location.origin}/song/${songId}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast("Couldn't copy link"),
    );
  }, [songId]);

  const totalLabel = fmtTime(durationSec);
  const curLabel = fmtTime(currentTime);
  const pct = `${(progress * 100).toFixed(1)}%`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0A]/85 backdrop-blur-xl px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.92 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[380px]"
            style={{ maxHeight: "calc(100svh - 48px)" }}
          >
            <div
              ref={cardRef}
              className="relative overflow-hidden rounded-[24px]"
              style={{ aspectRatio: "9/16" }}
            >
              <div className="absolute inset-0" style={bgStyle} />

              {artworkPath && (
                <div className="absolute inset-0 opacity-35">
                  <Image
                    src={artworkPath}
                    alt={artwork?.title ?? title}
                    fill
                    className="object-cover"
                    sizes="380px"
                  />
                </div>
              )}

              <div
                className="absolute inset-x-0 top-0 h-[18%] pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, transparent 100%)",
                }}
              />
              <div
                className="absolute inset-x-0 bottom-0 h-[55%] pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.18) 40%, transparent 100%)",
                }}
              />

              {/* ── Top-right: close + download ────────────────── */}
              <div className="absolute top-4 right-4 flex items-center gap-2.5 z-10">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-transform active:scale-90"
                  style={{ background: "rgba(255,255,255,0.16)" }}
                  aria-label="Download"
                >
                  <Download className="h-4 w-4 text-white/75" strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-transform active:scale-90"
                  style={{ background: "rgba(255,255,255,0.16)" }}
                  aria-label="Close"
                >
                  <X className="h-4 w-4 text-white/75" strokeWidth={2.6} />
                </button>
              </div>

              {/* ── Right-side: heart + share ─────────────────── */}
              <div
                className="absolute right-5 flex flex-col items-center gap-4"
                style={{ bottom: 88 }}
              >
                <button
                  type="button"
                  onClick={() => setLiked((v) => !v)}
                  className="flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-90"
                  style={{ background: "rgba(255,255,255,0.10)" }}
                >
                  <Heart
                    className="h-5 w-5"
                    style={{
                      color: liked ? "#FF5A5A" : "rgba(255,255,255,0.75)",
                      fill: liked ? "#FF5A5A" : "none",
                      transition: "color 0.2s, fill 0.2s",
                    }}
                  />
                </button>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-90"
                  style={{ background: "rgba(255,255,255,0.10)" }}
                >
                  <Share2
                    className="h-[18px] w-[18px] text-white/75"
                    strokeWidth={2.2}
                  />
                </button>
              </div>

              {/* ── Bottom content ──────────────────────────────── */}
              <div className="absolute inset-x-0 bottom-0 px-5 pb-6">
                <h2
                  className="hero-serif text-white leading-[0.93] pr-14"
                  style={{
                    fontSize: "clamp(34px, 9.5vw, 48px)",
                    letterSpacing: "-0.018em",
                    textShadow: "0 2px 14px rgba(0,0,0,0.4)",
                  }}
                >
                  {title}
                </h2>

                <div className="mt-2.5 flex items-center gap-2">
                  <div
                    className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: avatarGradient(user.id),
                      boxShadow: "0 0 0 1.5px rgba(255,255,255,0.25)",
                    }}
                  >
                    <span
                      className="text-[10px] font-semibold text-white/90 select-none"
                      style={{ lineHeight: 1 }}
                    >
                      {(displayName[0] ?? "C").toUpperCase()}
                    </span>
                  </div>
                  <span
                    className="text-[13px] font-medium text-white/72 tracking-[0.01em]"
                    style={{ textShadow: "0 1px 4px rgba(0,0,0,0.25)" }}
                  >
                    {displayName}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-1.5">
                  <span
                    className="rounded-full px-2.5 py-[3px] text-[10px] uppercase tracking-[0.12em] text-white/55 font-medium"
                    style={{ background: "rgba(255,255,255,0.08)" }}
                  >
                    {bpm} BPM
                  </span>
                  <span
                    className="rounded-full px-2.5 py-[3px] text-[10px] uppercase tracking-[0.12em] text-white/55 font-medium"
                    style={{ background: "rgba(255,255,255,0.08)" }}
                  >
                    {keySignature}
                  </span>
                </div>

                {/* Interactive playback bar */}
                <div className="mt-5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={skipBack}
                    disabled={!hasAudio}
                    className="flex h-7 w-7 shrink-0 items-center justify-center text-white/50 transition-colors hover:text-white/80 disabled:opacity-30"
                  >
                    <SkipBack className="h-[13px] w-[13px]" fill="currentColor" />
                  </button>

                  <button
                    type="button"
                    onClick={togglePlay}
                    disabled={!hasAudio}
                    className="flex h-8 w-8 shrink-0 items-center justify-center text-white/85 transition-colors hover:text-white disabled:opacity-30"
                  >
                    {playing ? (
                      <Pause className="h-4 w-4" fill="currentColor" />
                    ) : (
                      <Play className="h-4 w-4 ml-[1px]" fill="currentColor" />
                    )}
                  </button>

                  <div
                    ref={barRef}
                    className="flex-1 relative h-7 flex items-center cursor-pointer"
                    onClick={hasAudio ? seekTo : undefined}
                    onTouchStart={hasAudio ? seekTo : undefined}
                  >
                    <div
                      className="w-full h-[3px] rounded-full relative"
                      style={{ background: "rgba(255,255,255,0.20)" }}
                    >
                      <div
                        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200"
                        style={{
                          width: pct,
                          background: "rgba(255,255,255,0.85)",
                        }}
                      />
                      <div
                        className="absolute top-1/2 h-[10px] w-[10px] rounded-full bg-white transition-[left] duration-200"
                        style={{
                          left: pct,
                          transform: "translate(-50%, -50%)",
                          boxShadow: "0 0 6px rgba(255,255,255,0.35)",
                        }}
                      />
                    </div>
                  </div>

                  <span className="text-[10px] tabular-nums text-white/50 tracking-wide shrink-0 min-w-[64px] text-right">
                    {curLabel}
                    <span className="text-white/28 mx-[2px]">/</span>
                    {totalLabel}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
