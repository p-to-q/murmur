"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";

import { useTranslator } from "@/lib/i18n";
import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";

interface ShareCardModalProps {
  open: boolean;
  onClose: () => void;
}

const CAROUSEL_SLIDES = [
  {
    image: "/images/share-murmur-bg-v2.jpg",
    bylineKey: "share.byline" as const,
    objectPosition: "center 38%",
  },
  {
    image: "/images/share-esther-bg-v2.jpg",
    bylineKey: "share.byline.esther" as const,
    objectPosition: "center center",
  },
];

const DIRECTIONS = [
  { y: "100%", x: 0 }, // from bottom
  { y: "-100%", x: 0 }, // from top
  { x: "100%", y: 0 }, // from right
  { x: "-100%", y: 0 }, // from left
];

// Get opposite direction for exit animation
// If new slide enters from bottom, old slide exits to top (and vice versa)
const getOppositeDirection = (dir: { x: number | string; y: number | string }) => {
  if (typeof dir.y === "string" && dir.y !== "0") {
    // Vertical movement: flip the sign
    return { x: 0, y: dir.y.startsWith("-") ? dir.y.slice(1) : `-${dir.y}` };
  }
  if (typeof dir.x === "string" && dir.x !== "0") {
    // Horizontal movement: flip the sign
    return { y: 0, x: dir.x.startsWith("-") ? dir.x.slice(1) : `-${dir.x}` };
  }
  return { x: 0, y: 0 };
};

export function ShareCardModal({ open, onClose }: ShareCardModalProps) {
  const t = useTranslator();
  const { data: session } = useSession();
  const { signInWithGoogle } = useGoogleSignIn();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [enterDirection, setEnterDirection] = useState(() => DIRECTIONS[0]);

  useEffect(() => {
    if (session?.user) {
      onClose();
    }
  }, [session, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      setEnterDirection(DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)]);
      setCurrentSlide((prev) => (prev + 1) % CAROUSEL_SLIDES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [open]);

  const slide = CAROUSEL_SLIDES[currentSlide];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-4 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden rounded-[32px] shadow-2xl">
              <AnimatePresence initial={false}>
                {/*
                  Carousel animation logic:
                  - New slide enters from enterDirection (random)
                  - Old slide exits in opposite direction
                  - Example: new from right → old exits left
                */}
                <motion.div
                  key={currentSlide}
                  initial={{ ...enterDirection, scale: 0.95 }}
                  animate={{ x: 0, y: 0, scale: 1 }}
                  exit={{ ...getOppositeDirection(enterDirection), scale: 1.05 }}
                  transition={{
                    duration: 0.7,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="absolute inset-0"
                >
                  <Image
                    src={slide.image}
                    alt=""
                    width={736}
                    height={1104}
                    priority
                    className="share-card-photo h-[600px] w-full object-cover"
                    style={{ objectPosition: slide.objectPosition }}
                  />
                  <div aria-hidden className="share-card-photo-tone" />
                  <div aria-hidden className="share-card-photo-warmth" />
                  <div aria-hidden className="share-card-photo-grain" />
                  <div aria-hidden className="share-card-photo-dust" />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/10" />
                </motion.div>
              </AnimatePresence>
              <div className="relative h-[600px]" />

              <div className="absolute left-6 right-6 top-6 flex items-start justify-between">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={`byline-${currentSlide}`}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.3 }}
                    className="text-[15px] text-white/90 drop-shadow"
                  >
                    {t(slide.bylineKey)}
                  </motion.p>
                </AnimatePresence>
                <div className="flex items-center gap-4">
                  <Image
                    src="/brand/murmur-wordmark-source-cropped.png"
                    alt="MURMUR"
                    width={154}
                    height={28}
                    className="h-7 w-auto brightness-0 invert drop-shadow"
                  />
                  <button
                    onClick={onClose}
                    aria-label={t("common.cancel")}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-[#1A1A1A] backdrop-blur-sm transition-colors hover:bg-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="absolute bottom-6 left-6 right-6">
                <div className="rounded-[28px] bg-white/95 backdrop-blur-xl p-8 shadow-xl">
                  <h2 className="mb-8 text-center text-[20px] font-medium text-[#1A1A1A] leading-tight">
                    {t("share.tagline")}
                  </h2>

                  <button
                    onClick={() => signInWithGoogle("/")}
                    className="flex w-full items-center justify-center gap-3 rounded-full bg-[#EBEBEB] px-6 py-4 text-[16px] font-medium text-[#1A1A1A] transition-colors hover:bg-[#DCDCDC]"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    {t("share.google")}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
