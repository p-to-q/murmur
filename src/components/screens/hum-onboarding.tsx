"use client";

import {
  AnimatePresence,
  motion,
  type MotionValue,
  useMotionTemplate,
  useReducedMotion,
  useTransform,
} from "framer-motion";

/**
 * First-run onboarding overlay for the Hum screen.
 *
 * Design contract:
 *
 * 1. The overlay is the SOLE interaction surface during onboarding steps.
 *    It has pointer-events-auto and captures any click / tap / Space|Enter
 *    to advance the copy. The orb button underneath is visually available
 *    but unreachable via pointer — this keeps the user's focus on reading
 *    rather than hunting for a specific tap target.
 *
 * 2. During the final "melt web" reveal animation (rippling = true) the
 *    overlay becomes pointer-events-none and aria-hidden so the orb, now
 *    visible and unfrozen, becomes the active interaction surface for
 *    live recording.
 *
 * 3. Keyboard users reach the overlay via its role="button" + tabIndex={0}.
 *    Space / Enter on the overlay advance the step. If keyboard focus
 *    falls on the orb behind the overlay, the orb also delegates to
 *    handleOnboardingPress — the parent co-ordinates the two paths.
 *
 * See docs/page-contracts.md for the product-level contract.
 */

type OrbCenter = {
  x: number;
  y: number;
  size: number;
};

interface HumOnboardingOverlayProps {
  visible: boolean;
  orbCenter: OrbCenter;
  revealRadius: MotionValue<number>;
  rippling: boolean;
  line: string;
  onAdvance: () => void;
}

const MYMIND_EASE = [0.22, 1, 0.36, 1] as const;
export const HUM_ONBOARDING_REVEAL_DURATION_MS = 2300;
const BACKDROP_EXIT_DURATION_SECONDS = 1.08;
const PITCH_MARKS = new Set(["↗", "↘"]);
const PITCH_MARK_FONT =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI Symbol', 'Apple Symbols', sans-serif";
const COPY_CLASS =
  "max-w-[560px] text-[29px] leading-[1.12] md:text-[36px] md:leading-[1.1]";
const BRAND_FONT =
  "var(--font-instrument-serif), ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif";
const INTENT_TEXT_EASE = [0.2, 0.8, 0.2, 1] as const;
const COPY_CONTAINER_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};
const COPY_LINE_VARIANTS = {
  hidden: { opacity: 0, y: 5, filter: "blur(0px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  rippleExit: {
    opacity: 0,
    y: 12,
    filter: "blur(12px)",
    transition: {
      delay: BACKDROP_EXIT_DURATION_SECONDS,
      duration: 0.82,
      ease: INTENT_TEXT_EASE,
    },
  },
  swapExit: { opacity: 0, y: -5, filter: "blur(0px)" },
};
const WEB_STRANDS = [
  { rotate: -28, y: -72, delay: 0.06 },
  { rotate: -10, y: -24, delay: 0 },
  { rotate: 9, y: 28, delay: 0.04 },
  { rotate: 27, y: 76, delay: 0.1 },
] as const;

export function HumOnboardingOverlay({
  visible,
  orbCenter,
  revealRadius,
  rippling,
  line,
  onAdvance,
}: HumOnboardingOverlayProps) {
  const reduceMotion = useReducedMotion();
  const canRender = visible && orbCenter.y > 0;
  const maskRadius = useTransform(revealRadius, (r) => r || 0);
  const maskEdge = useTransform(revealRadius, (r) => (r || 0) + 44);
  const ringSize = useTransform(revealRadius, (r) => Math.max(180, (r || 0) * 2));
  const whisperSize = useTransform(revealRadius, (r) => Math.max(204, (r || 0) * 2.18));
  const copyTop = orbCenter.y - orbCenter.size / 2 - 58;
  const revealMask = useMotionTemplate`radial-gradient(circle at ${orbCenter.x}px ${orbCenter.y}px, transparent ${maskRadius}px, black ${maskEdge}px)`;
  const introDelay = reduceMotion ? 0.45 : 1.05;
  const copyDelay = reduceMotion ? 0.72 : 1.62;
  const meltSize =
    typeof window === "undefined"
      ? 1800
      : Math.max(window.innerWidth, window.innerHeight) * 1.9;

  return (
    <AnimatePresence>
      {canRender && (
        <motion.div
          key="hum-onboarding"
          aria-hidden={rippling}
          className={[
            "fixed inset-0 z-[60]",
            rippling ? "pointer-events-none" : "pointer-events-auto cursor-pointer",
          ].join(" ")}
          onClick={() => {
            if (!rippling) onAdvance();
          }}
          onKeyDown={(e) => {
            if (rippling) return;
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              onAdvance();
            }
          }}
          role={rippling ? undefined : "button"}
          tabIndex={rippling ? undefined : 0}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.15 : 0.28 }}
        >
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: rippling ? 0 : 1 }}
            transition={{
              duration: reduceMotion ? 0.18 : rippling ? BACKDROP_EXIT_DURATION_SECONDS : 0.9,
              delay: rippling ? 0 : introDelay,
              ease: MYMIND_EASE,
            }}
            style={{
              backdropFilter: "blur(22px) saturate(1.22)",
              WebkitBackdropFilter: "blur(22px) saturate(1.22)",
              background:
                "linear-gradient(180deg, rgba(245,241,235,0.30), rgba(245,241,235,0.52))",
              maskImage: revealMask,
              WebkitMaskImage: revealMask,
            }}
          />

          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: rippling ? 0 : 1 }}
            transition={{
              duration: reduceMotion ? 0.18 : 0.75,
              delay: rippling ? 0 : introDelay + 0.18,
              ease: MYMIND_EASE,
            }}
            style={{
              background: `radial-gradient(circle at ${orbCenter.x}px ${orbCenter.y}px, rgba(255,255,255,0.50) 0%, rgba(255,255,255,0.24) 42%, transparent 62%)`,
              maskImage: revealMask,
              WebkitMaskImage: revealMask,
            }}
          />

          <AnimatePresence>
            {!rippling && (
              <motion.div
                key="focus-ring"
                className="absolute rounded-full border border-white/70 shadow-[0_0_34px_rgba(255,255,255,0.42)]"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: reduceMotion ? 1 : [1, 1.018, 1] }}
                exit={{ opacity: 0, scale: 1.03 }}
                transition={{
                  opacity: {
                    duration: reduceMotion ? 0.18 : 0.7,
                    delay: copyDelay - 0.24,
                    ease: MYMIND_EASE,
                  },
                  scale: reduceMotion
                    ? { duration: 0.18 }
                    : { duration: 3.8, repeat: Infinity, ease: "easeInOut" },
                }}
                style={{
                  left: orbCenter.x,
                  top: orbCenter.y,
                  width: ringSize,
                  height: ringSize,
                  x: "-50%",
                  y: "-50%",
                }}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {!rippling && !reduceMotion && (
              <motion.div
                key="whisper-ring"
                className="absolute rounded-full border border-white/45"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: [0.12, 0.5, 0.12], scale: [0.96, 1.08, 0.96] }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: 4.2,
                  delay: copyDelay,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                style={{
                  left: orbCenter.x,
                  top: orbCenter.y,
                  width: whisperSize,
                  height: whisperSize,
                  x: "-50%",
                  y: "-50%",
                }}
              />
            )}
          </AnimatePresence>

          <motion.div
            key="onboarding-copy"
            data-hum-onboarding-copy
            className="absolute flex w-[min(92vw,560px)] flex-col items-center text-center"
            variants={COPY_CONTAINER_VARIANTS}
            initial="hidden"
            animate="visible"
            transition={{
              duration: reduceMotion ? 0.24 : 0.62,
              delay: copyDelay,
              ease: MYMIND_EASE,
            }}
            style={{ top: copyTop, left: orbCenter.x, x: "-50%", y: "-100%" }}
          >
            <AnimatePresence mode="wait">
              <motion.p
                key={line}
                variants={COPY_LINE_VARIANTS}
                className={[
                  "hero-serif whitespace-pre-line text-[#1A1A1A]/80 tracking-normal",
                  COPY_CLASS,
                ].join(" ")}
                initial="hidden"
                animate={rippling && !reduceMotion ? "rippleExit" : "visible"}
                exit="swapExit"
                transition={{
                  duration: reduceMotion ? 0.16 : 0.34,
                  ease: MYMIND_EASE,
                }}
                style={{ letterSpacing: 0 }}
              >
                {renderOnboardingLine(line, reduceMotion)}
              </motion.p>
            </AnimatePresence>
          </motion.div>

          <AnimatePresence>
            {rippling && !reduceMotion && (
              <motion.div
                key="melt-web"
                className="absolute inset-0 overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <motion.div
                  className="absolute rounded-full"
                  style={{
                    left: orbCenter.x,
                    top: orbCenter.y,
                    width: meltSize,
                    height: meltSize,
                    x: "-50%",
                    y: "-50%",
                    background:
                      "radial-gradient(circle, rgba(255,255,255,0) 0 18%, rgba(255,255,255,0.74) 24%, rgba(255,255,255,0.38) 36%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0) 64%)",
                    filter: "blur(10px)",
                  }}
                  initial={{ scale: 0.12, opacity: 0.74 }}
                  animate={{ scale: 1, opacity: 0 }}
                  transition={{ duration: 1.32, ease: [0.18, 1, 0.25, 1] }}
                />

                <motion.div
                  className="absolute rounded-full"
                  style={{
                    left: orbCenter.x,
                    top: orbCenter.y,
                    width: meltSize * 0.72,
                    height: meltSize * 0.54,
                    x: "-50%",
                    y: "-50%",
                    background:
                      "radial-gradient(ellipse, rgba(245,241,235,0.88) 0 18%, rgba(245,241,235,0.44) 34%, rgba(245,241,235,0) 68%)",
                    filter: "blur(18px)",
                  }}
                  initial={{ scaleX: 0.2, scaleY: 0.08, rotate: -7, opacity: 0.82 }}
                  animate={{ scaleX: 1.12, scaleY: 0.76, rotate: 4, opacity: 0 }}
                  transition={{ duration: 1.18, ease: [0.2, 0.9, 0.2, 1] }}
                />

                {WEB_STRANDS.map((strand, i) => (
                  <motion.div
                    key={`web-strand-${i}`}
                    className="absolute left-1/2 top-1/2 h-px w-[86vw] origin-center rounded-full bg-white/70 shadow-[0_0_10px_rgba(255,255,255,0.58)]"
                    style={{
                      x: "-50%",
                      y: `calc(-50% + ${strand.y}px)`,
                      rotate: strand.rotate,
                    }}
                    initial={{ scaleX: 0.08, opacity: 0, filter: "blur(0px)" }}
                    animate={{
                      scaleX: [0.08, 1, 1.12],
                      opacity: [0, 0.62, 0],
                      filter: ["blur(0px)", "blur(0px)", "blur(4px)"],
                    }}
                    transition={{
                      duration: 0.92,
                      delay: strand.delay,
                      ease: [0.2, 1, 0.32, 1],
                    }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function renderOnboardingLine(line: string, reduceMotion: boolean | null) {
  return line.split("\n").map((segment, lineIndex) => (
    <span key={`${segment}-${lineIndex}`} className="block whitespace-nowrap">
      {renderOnboardingSegment(segment, reduceMotion)}
    </span>
  ));
}

function renderOnboardingSegment(segment: string, reduceMotion: boolean | null) {
  return segment.split(/(Murmur|声音|[↗↘])/g).map((part, index) => {
    if (part === "Murmur") {
      return (
        <span
          key={`${part}-${index}`}
          className="inline-block align-baseline font-normal"
          style={{ fontFamily: BRAND_FONT }}
        >
          {part}
        </span>
      );
    }

    if (part === "声音") {
      if (reduceMotion) return part;

      return part.split("").map((char, charIndex) => (
        <motion.span
          key={`${part}-${index}-${char}`}
          className="inline-block"
          initial={{ opacity: 0, y: "0.18em", filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{
            duration: 0.34,
            delay: 0.42 + charIndex * 0.18,
            ease: MYMIND_EASE,
          }}
        >
          {char}
        </motion.span>
      ));
    }

    if (!PITCH_MARKS.has(part)) return part;

    return (
      <span
        key={`${part}-${index}`}
        className="inline-block px-[0.02em] text-[0.86em] leading-none"
        style={{
          fontFamily: PITCH_MARK_FONT,
          transform: part === "↗" ? "translateY(-0.04em)" : "translateY(0.04em)",
        }}
      >
        {part}
      </span>
    );
  });
}
