"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { X, Link as LinkIcon, Check } from "lucide-react";

import { useTranslator } from "@/lib/i18n";
import { AuthButtons } from "@/components/auth/auth-buttons";
import { EmailLoginForm } from "@/components/auth/email-login-form";
import { copyShareInviteLink } from "@/lib/platform/share-invite";
import { useCurrentAccount } from "@/lib/hooks/use-current-account";

interface ShareCardModalProps {
  open: boolean;
  onClose: () => void;
  shareUrl?: string | null;
}

const CAROUSEL_SLIDES = [
  {
    image: "/images/share-murmur-bg-v3.png",
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
  { x: 0, y: "-100%" }, // old exits top; new enters from bottom
  { x: 0, y: "100%" }, // old exits bottom; new enters from top
  { x: "-100%", y: 0 }, // old exits left; new enters from right
  { x: "100%", y: 0 }, // old exits right; new enters from left
] as const;

type SlideDirection = (typeof DIRECTIONS)[number];
interface CarouselLayer {
  id: number;
  slideIndex: number;
  direction: SlideDirection;
  role: "active" | "exiting";
}

function invertDirection(direction: SlideDirection): SlideDirection {
  return {
    x: typeof direction.x === "string"
      ? direction.x.startsWith("-")
        ? direction.x.slice(1)
        : `-${direction.x}`
      : 0,
    y: typeof direction.y === "string"
      ? direction.y.startsWith("-")
        ? direction.y.slice(1)
        : `-${direction.y}`
      : 0,
  } as SlideDirection;
}

function randomExitDirection(): SlideDirection {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
}

function translate(direction: SlideDirection) {
  return `translate3d(${direction.x}, ${direction.y}, 0)`;
}

function preloadShareImages() {
  if (typeof window === "undefined") return;

  for (const slide of CAROUSEL_SLIDES) {
    const existing = document.head.querySelector(
      `link[rel="preload"][as="image"][href="${slide.image}"]`,
    );
    if (!existing) {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = slide.image;
      document.head.appendChild(link);
    }

    const image = new window.Image();
    image.src = slide.image;
    image.decode?.().catch(() => {});
  }
}

function initialLayer(): CarouselLayer {
  return {
    id: 0,
    slideIndex: 0,
    direction: DIRECTIONS[0],
    role: "active",
  };
}

export function ShareCardModal({ open, onClose, shareUrl }: ShareCardModalProps) {
  const t = useTranslator();
  const { isRegistered } = useCurrentAccount();
  const [showEmail, setShowEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const cleanupTimerRef = useRef<number | null>(null);
  const [layers, setLayers] = useState<CarouselLayer[]>(() => [initialLayer()]);
  const [isMoving, setIsMoving] = useState(false);

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
      const exitDirection = randomExitDirection();
      setIsMoving(false);
      setLayers((prev) => {
        const active = prev.find((layer) => layer.role === "active") ?? initialLayer();
        return [
          { ...active, direction: exitDirection, role: "exiting" },
          {
            id: active.id + 1,
            slideIndex: (active.slideIndex + 1) % CAROUSEL_SLIDES.length,
            direction: exitDirection,
            role: "active",
          },
        ];
      });

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = window.requestAnimationFrame(() => {
          setIsMoving(true);
        });
      });

      if (cleanupTimerRef.current !== null) {
        window.clearTimeout(cleanupTimerRef.current);
      }
      cleanupTimerRef.current = window.setTimeout(() => {
        setLayers((prev) =>
          prev
            .filter((layer) => layer.role === "active")
            .map((layer) => ({
              ...layer,
              direction: DIRECTIONS[0],
            })),
        );
        setIsMoving(false);
      }, 760);
    }, 3000);
    return () => {
      clearInterval(interval);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (cleanupTimerRef.current !== null) {
        window.clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
    };
  }, [open]);

  useEffect(() => {
    preloadShareImages();
  }, []);

  const activeLayer = layers.find((layer) => layer.role === "active") ?? layers[0];
  const currentSlide = activeLayer.slideIndex;
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
            className="relative mx-4 max-h-[90svh] w-full max-w-md overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="share-card-shell relative isolate overflow-hidden rounded-[32px] shadow-2xl">
              {layers.map((layer) => {
                const slideItem = CAROUSEL_SLIDES[layer.slideIndex];
                const enterDirection = invertDirection(layer.direction);
                const isTransitioning = layers.length > 1;
                const transform = layer.role === "exiting"
                  ? isMoving
                    ? translate(layer.direction)
                    : "translate3d(0, 0, 0)"
                  : !isTransitioning || isMoving
                    ? "translate3d(0, 0, 0)"
                    : translate(enterDirection);

                return (
                  <div
                    key={`${layer.role}-${layer.id}`}
                    className="absolute inset-0 overflow-hidden rounded-[32px] will-change-transform"
                    style={{
                      transform,
                      transition: isMoving
                        ? "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)"
                        : "none",
                    }}
                  >
                    <Image
                      src={slideItem.image}
                      alt=""
                      width={736}
                      height={1104}
                      priority={layer.slideIndex === 0}
                      className="share-card-photo h-[600px] w-full object-cover"
                      style={{ objectPosition: slideItem.objectPosition }}
                    />
                    <div aria-hidden className="share-card-photo-tone" />
                    <div aria-hidden className="share-card-photo-warmth" />
                    <div aria-hidden className="share-card-photo-grain" />
                    <div aria-hidden className="share-card-photo-dust" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/10" />
                  </div>
                );
              })}
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
                <div className="share-card-panel overflow-hidden rounded-[28px] bg-white/95 p-8 shadow-xl backdrop-blur-xl">
                  <h2 className="mb-8 text-center text-[20px] font-medium text-[#1A1A1A] leading-tight">
                    {t("share.tagline")}
                  </h2>

                  {isRegistered ? (
                    <button
                      onClick={async () => {
                        if (!shareUrl) return;
                        await copyShareInviteLink(shareUrl, {
                          copied: t("share.copied"),
                          copyFailed: t("share.copy_failed"),
                        });
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="flex w-full items-center justify-center gap-2.5 rounded-full border border-[#E0DDD5] bg-white px-6 py-3.5 text-[15px] font-medium text-[#1A1A1A] shadow-sm transition-all hover:shadow-md"
                    >
                      {copied ? (
                        <Check className="h-4.5 w-4.5 text-[#1A1A1A]" strokeWidth={2.1} />
                      ) : (
                        <LinkIcon className="h-4.5 w-4.5" />
                      )}
                      {copied ? t("share.copied") : t("share.copy_link")}
                    </button>
                  ) : showEmail ? (
                    <EmailLoginForm
                      className="text-left"
                      onSuccess={() => setShowEmail(false)}
                    />
                  ) : (
                    <AuthButtons
                      callbackUrl="/"
                      onEmailClick={() => setShowEmail(true)}
                    />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
