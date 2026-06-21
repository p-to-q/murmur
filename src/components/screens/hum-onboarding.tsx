"use client";

import {
  AnimatePresence,
  motion,
  type MotionValue,
  useMotionTemplate,
  useReducedMotion,
  useTransform,
} from "framer-motion";

type OrbCenter = {
  x: number;
  y: number;
};

interface HumOnboardingOverlayProps {
  visible: boolean;
  orbCenter: OrbCenter;
  revealRadius: MotionValue<number>;
  rippling: boolean;
  title: string;
  hint: string;
}

const MYMIND_EASE = [0.22, 1, 0.36, 1] as const;

export function HumOnboardingOverlay({
  visible,
  orbCenter,
  revealRadius,
  rippling,
  title,
  hint,
}: HumOnboardingOverlayProps) {
  const reduceMotion = useReducedMotion();
  const canRender = visible && orbCenter.y > 0;
  const maskRadius = useTransform(revealRadius, (r) => r || 0);
  const maskEdge = useTransform(revealRadius, (r) => (r || 0) + 44);
  const ringSize = useTransform(revealRadius, (r) => Math.max(180, (r || 0) * 2));
  const whisperSize = useTransform(revealRadius, (r) => Math.max(204, (r || 0) * 2.18));
  const revealMask = useMotionTemplate`radial-gradient(circle at ${orbCenter.x}px ${orbCenter.y}px, transparent ${maskRadius}px, black ${maskEdge}px)`;
  const copyTop = Math.max(88, orbCenter.y - 258);
  const introDelay = reduceMotion ? 0.05 : 1.05;
  const copyDelay = reduceMotion ? 0.1 : 1.62;
  const rippleSize =
    typeof window === "undefined"
      ? 1800
      : Math.max(window.innerWidth, window.innerHeight) * 2.2;

  return (
    <AnimatePresence>
      {canRender && (
        <motion.div
          key="hum-onboarding"
          aria-hidden="true"
          className="fixed inset-0 z-[60] pointer-events-none"
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.15 : 0.28 }}
        >
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: rippling ? 0.88 : 1 }}
            transition={{
              duration: reduceMotion ? 0.2 : 0.9,
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

          <AnimatePresence>
            {!rippling && (
              <motion.div
                key="onboarding-copy"
                className="absolute flex w-[min(78vw,340px)] flex-col items-center text-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{
                  duration: reduceMotion ? 0.22 : 0.72,
                  delay: copyDelay,
                  ease: MYMIND_EASE,
                }}
                style={{ top: copyTop, left: orbCenter.x, x: "-50%" }}
              >
                <p className="hero-serif text-[#1A1A1A]/82 text-[27px] leading-[1.16] md:text-[34px]">
                  {title}
                </p>
                <p className="mt-3 max-w-[260px] text-[12px] leading-relaxed text-[#8C8780] md:max-w-[300px] md:text-[13px]">
                  {hint}
                </p>
                <motion.span
                  className="mt-5 h-8 w-px bg-gradient-to-b from-[#1A1A1A]/20 to-transparent"
                  animate={reduceMotion ? undefined : { scaleY: [0.72, 1, 0.72] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {rippling && !reduceMotion && (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={`ripple-${i}`}
                    className="absolute rounded-full pointer-events-none"
                    style={{
                      left: orbCenter.x,
                      top: orbCenter.y,
                      x: "-50%",
                      y: "-50%",
                      border: `${1.45 - i * 0.16}px solid rgba(255,255,255,${0.54 - i * 0.08})`,
                      boxShadow: `0 0 ${14 - i * 1.6}px rgba(255,255,255,${0.20 - i * 0.03})`,
                    }}
                    initial={{ width: 0, height: 0, opacity: 0.82 }}
                    animate={{
                      width: rippleSize,
                      height: rippleSize,
                      opacity: 0,
                    }}
                    transition={{
                      duration: 1.65,
                      delay: i * 0.08,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                ))}
              </>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
