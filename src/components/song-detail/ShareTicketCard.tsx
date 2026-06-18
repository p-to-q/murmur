"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { X, Check, ArrowUpLeft } from "lucide-react";
import { toast } from "sonner";
import type { VisualArtwork } from "@/modules/shared/types";
import { CanvasCoverArt } from "@/components/gallery/CanvasCoverArt";

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

  const year = new Date(createdAt).getFullYear();
  const durMin = Math.floor(durationSec / 60);
  const durSec = Math.round(durationSec % 60);
  const durLabel = `${pad2(durMin)}:${pad2(durSec)}`;

  const artworkPath = artwork?.backgroundImagePath ?? artwork?.imagePath;

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
      a.download = `${slug}-ticket.png`;
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
        const file = new File([blob], `${slug}-ticket.png`, {
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
        a.download = `${slug}-ticket.png`;
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
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#1A1A1A]/80 backdrop-blur-md px-3"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)", paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
          onClick={onClose}
        >
          {/* ── Ticket card ──────────────────────────────────────────── */}
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
              style={{ aspectRatio: "9/16" }}
            >
              {/* Background artwork / gradient */}
              <div className="absolute inset-0">
                {artworkPath ? (
                  <Image
                    src={artworkPath}
                    alt={artwork?.title ?? title}
                    fill
                    className="object-cover"
                    sizes="380px"
                  />
                ) : (
                  <CanvasCoverArt
                    songId={songId}
                    gradient={gradient}
                    className="w-full h-full"
                  />
                )}
              </div>

              {/* Top vignette */}
              <div
                className="absolute inset-x-0 top-0 h-1/4 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 100%)",
                }}
              />

              {/* Bottom vignette — heavier for text readability */}
              <div
                className="absolute inset-x-0 bottom-0 h-3/5 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.20) 50%, rgba(0,0,0,0) 100%)",
                }}
              />

              {/* ── Title ──────────────────────────────────────────── */}
              <div className="absolute inset-x-0 bottom-0 px-7 pb-7">
                <h2
                  className="hero-serif text-white leading-[0.95] tracking-[-0.02em]"
                  style={{ fontSize: "clamp(38px, 10vw, 52px)" }}
                >
                  {title}
                </h2>

                {/* ── Dashed separator ─────────────────────────────── */}
                <div
                  className="mt-5 border-t border-dashed"
                  style={{ borderColor: "rgba(255,255,255,0.40)" }}
                />

                {/* ── Ticket stub: time / row / seat ───────────────── */}
                <div className="mt-4 flex items-end justify-between">
                  <TicketField label="time" value={String(year)} />
                  <TicketField label="bpm" value={String(bpm)} />
                  <TicketField label="key" value={keySignature} />
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Action bar + duration ────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ delay: 0.12, duration: 0.35 }}
            onClick={(e) => e.stopPropagation()}
            className="mt-4 w-full max-w-[420px] flex items-center justify-between flex-shrink-0"
          >
            {/* Duration — bottom left */}
            <span className="text-[13px] tabular-nums text-white/40 tracking-wide pl-1">
              {durLabel}
            </span>

            {/* Buttons cluster */}
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
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
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

function TicketField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start">
      <span
        className="text-[11px] uppercase tracking-[0.18em] leading-none"
        style={{ color: "rgba(255,255,255,0.55)" }}
      >
        {label}
      </span>
      <span
        className="hero-serif tabular-nums leading-none mt-1.5"
        style={{ fontSize: "clamp(28px, 7vw, 38px)", color: "rgba(255,255,255,0.80)" }}
      >
        {value}
      </span>
    </div>
  );
}
