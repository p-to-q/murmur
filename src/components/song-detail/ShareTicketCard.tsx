"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { Spinner } from "@/components/ui/spinner";
import {
  X,
  Check,
  ArrowUpLeft,
  Heart,
  Music2,
  MessageCircle,
  Share2,
  MoreHorizontal,
  SkipBack,
  Pause,
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
  open: boolean;
  onClose: () => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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
  createdAt,
  open,
  onClose,
}: ShareTicketCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

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

  const durMin = Math.floor(durationSec / 60);
  const durSec = Math.round(durationSec % 60);
  const durLabel = `${pad2(durMin)}:${pad2(durSec)}`;

  const artworkPath = artwork?.backgroundImagePath ?? artwork?.imagePath;
  const bgStyle = useMemo(
    () => buildMeshGradient(gradient, artwork?.palette),
    [gradient, artwork?.palette],
  );

  const captureCard = useCallback(async (): Promise<Blob | null> => {
    const node = cardRef.current;
    if (!node) return null;
    try {
      const mod = (await import("html2canvas")) as unknown as {
        default: (
          el: HTMLElement,
          opts?: {
            backgroundColor?: string | null;
            scale?: number;
            useCORS?: boolean;
            logging?: boolean;
          },
        ) => Promise<HTMLCanvasElement>;
      };
      const canvas = await mod.default(node, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png", 0.95),
      );
    } catch (e) {
      console.error("[ShareTicketCard] capture failed:", e);
      return null;
    }
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const blob = await captureCard();
      if (!blob) {
        toast.error("Failed to capture card");
        return;
      }
      const slug = title.replace(/\s+/g, "-").toLowerCase();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}-card.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast.success("Card saved");
    } finally {
      setSaving(false);
    }
  }, [captureCard, title]);

  const handleShare = useCallback(async () => {
    setSaving(true);
    try {
      const blob = await captureCard();
      if (!blob) {
        toast.error("Failed to capture card");
        return;
      }
      const slug = title.replace(/\s+/g, "-").toLowerCase();
      if (navigator.share) {
        const file = new File([blob], `${slug}-card.png`, {
          type: "image/png",
        });
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
        console.error("[ShareTicketCard] share failed:", e);
        toast.error("Share failed");
      }
    } finally {
      setSaving(false);
    }
  }, [captureCard, title]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0A0A0A]/85 backdrop-blur-xl px-3"
          style={{
            paddingTop: "max(env(safe-area-inset-top, 0px), 12px)",
            paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)",
          }}
          onClick={onClose}
        >
          {/* ── TikTok-style card ───────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.92 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[420px]"
            style={{ maxHeight: "calc(100vh - 100px)" }}
          >
            <div
              ref={cardRef}
              className="relative overflow-hidden rounded-[28px]"
              style={{ aspectRatio: "9/16" }}
            >
              {/* ── Mesh gradient background ──────────────── */}
              <div className="absolute inset-0" style={bgStyle} />

              {/* ── Artwork overlay ───────────────────────── */}
              {artworkPath && (
                <div className="absolute inset-0 opacity-35">
                  <Image
                    src={artworkPath}
                    alt={artwork?.title ?? title}
                    fill
                    className="object-cover"
                    sizes="420px"
                  />
                </div>
              )}

              {/* ── Top vignette ──────────────────────────── */}
              <div
                className="absolute inset-x-0 top-0 h-[22%] pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, transparent 100%)",
                }}
              />

              {/* ── Bottom vignette ───────────────────────── */}
              <div
                className="absolute inset-x-0 bottom-0 h-[62%] pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0.16) 45%, transparent 100%)",
                }}
              />

              {/* ── Top bar: MURMUR label + close ────────── */}
              <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5 pt-5">
                <div className="w-8" />
                <div
                  className="rounded-[6px] px-3.5 py-1.5"
                  style={{ background: "rgba(26,26,26,0.58)" }}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/90">
                    FOR YOU
                  </span>
                </div>
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ background: "rgba(255,255,255,0.16)" }}
                >
                  <X
                    className="h-3.5 w-3.5 text-white/75"
                    strokeWidth={2.8}
                  />
                </div>
              </div>

              {/* ── Right-side action buttons ─────────────── */}
              <div
                className="absolute right-4 flex flex-col items-center gap-[18px]"
                style={{ bottom: "130px" }}
              >
                <SideAction
                  icon={<Heart className="h-[22px] w-[22px]" />}
                />
                <SideAction
                  icon={<Music2 className="h-[22px] w-[22px]" />}
                />
                <SideAction
                  icon={
                    <MessageCircle className="h-[22px] w-[22px]" />
                  }
                />
                <SideAction
                  icon={<Share2 className="h-[22px] w-[22px]" />}
                />
                <SideAction
                  icon={
                    <MoreHorizontal className="h-[22px] w-[22px]" />
                  }
                  ghost
                />
              </div>

              {/* ── Bottom content ────────────────────────── */}
              <div className="absolute inset-x-0 bottom-0 px-5 pb-5">
                {/* Title */}
                <h2
                  className="hero-serif text-white leading-[0.93] pr-14"
                  style={{
                    fontSize: "clamp(34px, 9.5vw, 48px)",
                    letterSpacing: "-0.015em",
                    textShadow: "0 2px 12px rgba(0,0,0,0.35)",
                  }}
                >
                  {title}
                </h2>

                {/* User row */}
                <div className="mt-3.5 flex items-center gap-2.5">
                  <div
                    className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: avatarGradient(user.id),
                      boxShadow: "0 0 0 2px rgba(255,255,255,0.32)",
                    }}
                  >
                    <span
                      className="text-[12px] font-semibold text-white/90 select-none"
                      style={{
                        lineHeight: 1,
                        textShadow: "0 1px 2px rgba(0,0,0,0.15)",
                      }}
                    >
                      {(displayName[0] ?? "C").toUpperCase()}
                    </span>
                  </div>
                  <span
                    className="text-[13px] font-medium text-white/80"
                    style={{
                      textShadow: "0 1px 4px rgba(0,0,0,0.25)",
                    }}
                  >
                    {displayName}
                  </span>
                </div>

                {/* BPM + key badges */}
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className="rounded-full px-2.5 py-[3px] text-[10px] uppercase tracking-[0.16em] text-white/70"
                    style={{ background: "rgba(255,255,255,0.12)" }}
                  >
                    {bpm} BPM
                  </span>
                  <span
                    className="rounded-full px-2.5 py-[3px] text-[10px] uppercase tracking-[0.16em] text-white/70"
                    style={{ background: "rgba(255,255,255,0.12)" }}
                  >
                    {keySignature}
                  </span>
                </div>

                {/* Playback bar */}
                <div className="mt-4 flex items-center gap-2.5">
                  <SkipBack
                    className="h-[14px] w-[14px] text-white/50 shrink-0"
                    fill="currentColor"
                  />
                  <Pause
                    className="h-[16px] w-[16px] text-white/80 shrink-0"
                    fill="currentColor"
                  />
                  <div
                    className="flex-1 relative h-[3px] rounded-full"
                    style={{ background: "rgba(255,255,255,0.22)" }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: "38%",
                        background: "rgba(255,255,255,0.85)",
                      }}
                    />
                    <div
                      className="absolute top-1/2 h-[8px] w-[8px] rounded-full bg-white"
                      style={{
                        left: "38%",
                        transform: "translate(-50%, -50%)",
                        boxShadow: "0 0 6px rgba(255,255,255,0.4)",
                      }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-white/50 tracking-wide shrink-0 min-w-[36px] text-right">
                    {durLabel}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Action bar below card ────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ delay: 0.12, duration: 0.35 }}
            onClick={(e) => e.stopPropagation()}
            className="mt-4 w-full max-w-[420px] flex items-center justify-between flex-shrink-0"
          >
            <span className="text-[13px] tabular-nums text-white/40 tracking-wide pl-1">
              {durLabel}
            </span>
            <div className="flex items-center gap-4">
              <button
                onClick={onClose}
                className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#2A2A2A] text-white/80 transition-colors hover:bg-[#3A3A3A] active:scale-95"
                aria-label="Close"
              >
                <X className="h-5 w-5" strokeWidth={2.2} />
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#2A2A2A] text-white/90 transition-colors hover:bg-[#3A3A3A] active:scale-95 disabled:opacity-50"
                aria-label="Save"
              >
                {saving ? (
                  <Spinner size="md" variant="light" />
                ) : (
                  <Check className="h-6 w-6" strokeWidth={2.4} />
                )}
              </button>
              <button
                onClick={handleShare}
                disabled={saving}
                className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#2A2A2A] text-white/80 transition-colors hover:bg-[#3A3A3A] active:scale-95 disabled:opacity-50"
                aria-label="Share"
              >
                <ArrowUpLeft className="h-5 w-5" strokeWidth={2.2} />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SideAction({
  icon,
  ghost,
}: {
  icon: React.ReactNode;
  ghost?: boolean;
}) {
  return (
    <div
      className="flex h-[42px] w-[42px] items-center justify-center rounded-full text-white/80"
      style={{
        background: ghost ? "transparent" : "rgba(255,255,255,0.10)",
      }}
    >
      {icon}
    </div>
  );
}
