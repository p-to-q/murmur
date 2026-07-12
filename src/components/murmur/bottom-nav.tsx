"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Fragment, useEffect, useMemo, useRef } from "react";
import type { MouseEvent } from "react";

import {
  getRecoverableCreationRoute,
  useMurmurStore,
} from "@/lib/store/murmur-store";
import { getPlayer } from "@/lib/music/tone-player";
import { useCurrentLang, useTranslator } from "@/lib/i18n";
import {
  MOBILE_JOURNEY_STEPS,
  ownsJourneyNav,
  resolveMobileJourneyStage,
} from "./nav-items";
import { cn } from "@/lib/cn";

const MOBILE_RAIL_STOP_HREFS = new Set(["/", "/gallery"]);
const SOUNDWAVE_BAR_COUNT = 9;
const SOUNDWAVE_BAR_WIDTH = 1.35;

type RailStepState = "completed" | "current" | "upcoming";
type BridgeState = "completed" | "active" | "upcoming";

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const lang = useCurrentLang();
  const reduceMotion = useReducedMotion();
  const recordingState = useMurmurStore((state) => state.recordingState);
  const isProcessing = recordingState === "processing";
  const railTrackRef = useRef<HTMLDivElement>(null);

  const goHome = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    getPlayer().stop().catch(() => {});
    const recoverableRoute = getRecoverableCreationRoute();
    router.push(recoverableRoute ?? "/");
  };

  const stage = resolveMobileJourneyStage(pathname);
  const visibleSteps = useMemo(
    () =>
      MOBILE_JOURNEY_STEPS.filter((step) => {
        if (MOBILE_RAIL_STOP_HREFS.has(step.href)) return true;
        return stage >= step.unlockAt;
      }),
    [stage],
  );
  const activeIndex = resolveMobileActiveIndex(stage, visibleSteps.length);
  const activeBridgeIndex = resolveActiveBridgeIndex(activeIndex, visibleSteps.length);

  useEffect(() => {
    const track = railTrackRef.current;
    const activeItem = track?.querySelector<HTMLElement>(
      "[data-mobile-rail-active='true']",
    );
    if (!track || !activeItem) return;

    const activeCenter = activeItem.offsetLeft + activeItem.offsetWidth / 2;
    const scrollLeft = activeCenter - track.clientWidth / 2;
    track.scrollTo({
      left: Math.max(0, scrollLeft),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [activeIndex, pathname, reduceMotion, visibleSteps.length]);

  // Scope the journey rail to journey routes only. Non-journey surfaces
  // (top-up checkout, the /me account hub, privacy, auth, share landings)
  // never render the bottom rail. Kept below the hooks so hook order is stable.
  if (!ownsJourneyNav(pathname)) return null;

  return (
    <motion.nav
      initial={reduceMotion ? false : { y: 12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center md:hidden pointer-events-none"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}
      aria-label="Primary navigation"
    >
      <div className="pointer-events-auto relative w-full max-w-[340px] px-0.5">
        <div className="mobile-rail-shell mobile-rail-shell--compact relative isolate overflow-hidden rounded-[18px] border border-[#E6DED3]">
          <div
            ref={railTrackRef}
            className="mobile-rail-track relative overflow-x-auto overflow-y-hidden snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            <LayoutGroup id="mobile-journey-rail">
              <div className="mobile-rail-inner flex w-full items-center px-1 py-[4px]">
                {visibleSteps.map((step, index) => (
                  <Fragment key={step.href}>
                    <RailStep
                      href={step.href}
                      label={t(step.labelKey) || step.fallback}
                      lang={lang}
                      state={resolveStepState(index, activeIndex)}
                      onHome={step.href === "/"}
                      onHomeClick={goHome}
                    />
                    {index < visibleSteps.length - 1 ? (
                      <SoundwaveBridge
                        state={resolveBridgeState(index, activeBridgeIndex)}
                        activity={resolveBridgeActivity(
                          resolveBridgeState(index, activeBridgeIndex),
                          isProcessing,
                        )}
                        reduceMotion={reduceMotion}
                      />
                    ) : null}
                  </Fragment>
                ))}
              </div>
            </LayoutGroup>
          </div>
        </div>
      </div>
    </motion.nav>
  );
}

function resolveMobileActiveIndex(stage: number, visibleCount: number): number {
  if (visibleCount <= 0) return 0;
  if (stage < 0) return 0;
  return Math.min(stage, visibleCount - 1);
}

function resolveBridgeState(
  index: number,
  activeBridgeIndex: number,
): BridgeState {
  if (index === activeBridgeIndex) return "active";
  if (index < activeBridgeIndex) return "completed";
  return "upcoming";
}

function resolveStepState(index: number, activeIndex: number): RailStepState {
  if (index < activeIndex) return "completed";
  if (index === activeIndex) return "current";
  return "upcoming";
}

function resolveActiveBridgeIndex(activeIndex: number, visibleCount: number): number {
  if (visibleCount < 2) return 0;
  if (activeIndex <= 0) return -1;
  return Math.max(0, Math.min(activeIndex, visibleCount - 2));
}

function resolveBridgeActivity(
  state: BridgeState,
  isProcessing: boolean,
): number {
  switch (state) {
    case "active":
      return isProcessing ? 0.76 : 0.24;
    case "completed":
      return isProcessing ? 0.24 : 0.08;
    default:
      return isProcessing ? 0.14 : 0.04;
  }
}

function RailStep({
  href,
  label,
  lang,
  state,
  onHome,
  onHomeClick,
}: {
  href: string;
  label: string;
  lang: string;
  state: RailStepState;
  onHome: boolean;
  onHomeClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const isCurrent = state === "current";
  const isUpcoming = state === "upcoming";
  const textClass = cn(
    "max-w-[80px] truncate text-center leading-none transition-colors",
    lang === "zh"
      ? isCurrent
        ? "font-chinese-title text-[17px]"
        : "font-chinese-title text-[16px]"
      : isCurrent
        ? "font-serif-italic text-[17px]"
        : "font-serif text-[16px]",
    isUpcoming ? "text-[#8C8780]" : "text-[#1A1A1A]",
  );

  const content = (
    <span
      className={cn(
        "flex min-w-0 flex-none flex-col items-center justify-center px-0.5 py-[1px] transition-transform",
        isCurrent ? "scale-[1.03]" : "scale-100",
        isUpcoming ? "opacity-[0.76]" : "opacity-100",
      )}
    >
      <span className={textClass} title={label}>{label}</span>
      {isCurrent ? (
        <motion.span
          layoutId="mobile-rail-active-line"
          className="mt-[2px] h-[2.5px] rounded-full bg-[#FF762F]"
          style={{ width: 22 }}
          transition={{ type: "spring", stiffness: 540, damping: 40, mass: 0.45 }}
        />
      ) : null}
    </span>
  );

  const cls = cn(
    "relative z-10 flex min-w-0 flex-none snap-center justify-center px-0.5 py-0.5 transition-transform active:scale-[0.98]",
  );

  if (onHome) {
    return (
      <button
        type="button"
        onClick={onHomeClick}
        aria-current={isCurrent ? "page" : undefined}
        data-mobile-rail-active={isCurrent ? "true" : undefined}
        className={cls}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={href}
      aria-current={isCurrent ? "page" : undefined}
      data-mobile-rail-active={isCurrent ? "true" : undefined}
      className={cls}
      suppressHydrationWarning
    >
      {content}
    </Link>
  );
}

function SoundwaveBridge({
  state,
  activity,
  reduceMotion,
}: {
  state: BridgeState;
  activity: number;
  reduceMotion: boolean | null;
}) {
  const bars = useMemo(() => buildSoundwaveBars(state, activity), [state, activity]);
  const barColor = resolveSoundwaveColor(state, activity);
  const opacity =
    state === "active" ? 0.96 : state === "completed" ? 0.72 + activity * 0.08 : 0.42 + activity * 0.04;
  const duration =
    state === "active" ? 2.4 : state === "completed" ? 3.8 : 5.6;

  return (
    <motion.div
      aria-hidden
      className="relative flex-none snap-center overflow-hidden px-[1px]"
      style={{ width: 24, height: 16, transformOrigin: "50% 50%" }}
      animate={reduceMotion ? { opacity } : { opacity: [opacity * 0.94, opacity, opacity * 0.97] }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }
      }
    >
      <div className="flex h-full items-center justify-center gap-[1px]">
        {bars.map((bar) => (
          <motion.span
            key={bar.key}
            className="block rounded-full"
            style={{
              width: `${SOUNDWAVE_BAR_WIDTH}px`,
              backgroundColor: barColor,
            }}
            animate={
              reduceMotion
                ? { height: bar.rest, opacity: bar.opacity }
                : {
                    height: [bar.rest, bar.peak, bar.settle],
                    opacity: [bar.opacity * 0.9, bar.opacity, bar.opacity * 0.96],
                  }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: bar.duration,
                    delay: bar.delay,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }
            }
          />
        ))}
      </div>
    </motion.div>
  );
}

type SoundwaveBar = {
  key: string;
  rest: number;
  peak: number;
  settle: number;
  duration: number;
  delay: number;
  opacity: number;
};

function buildSoundwaveBars(
  state: BridgeState,
  activity: number,
): SoundwaveBar[] {
  const baseDelay = state === "active" ? 0.045 : state === "completed" ? 0.06 : 0.075;
  const baseFloor = state === "active" ? 1.4 : state === "completed" ? 1.15 : 0.92;
  const amplitude = state === "active" ? 1 : state === "completed" ? 0.58 : 0.22;

  return Array.from({ length: SOUNDWAVE_BAR_COUNT }, (_, index) => {
    const midpoint = (SOUNDWAVE_BAR_COUNT - 1) / 2;
    const center = midpoint <= 0 ? 1 : 1 - Math.abs(index - midpoint) / midpoint;
    const grainA = fractionalNoise(index + 1.37);
    const grainB = fractionalNoise(index * 1.91 + 7.3);
    const envelope = 0.42 + center * 0.58;
    const calmBreath = 0.64 + activity * 0.72;

    const rest =
      baseFloor + envelope * amplitude * (0.52 + activity * 0.42) + grainA * (state === "active" ? 0.18 : 0.1);
    const peak =
      rest +
      (state === "active" ? 3.8 : state === "completed" ? 2 : 0.7) +
      envelope * calmBreath * (state === "active" ? 2.8 : state === "completed" ? 1.5 : 0.5) +
      grainB * (state === "active" ? 0.55 : 0.28);
    const settle =
      rest +
      (state === "active" ? 2.1 : state === "completed" ? 1.1 : 0.18) +
      envelope * (state === "active" ? 0.82 : state === "completed" ? 0.5 : 0.18) +
      grainB * (state === "active" ? 0.22 : 0.12);
    const duration =
      state === "active"
        ? 1.2 + grainA * 0.28
        : state === "completed"
          ? 2.6 + grainA * 0.42
          : 4.8 + grainA * 0.8;
    const opacity =
      state === "active"
        ? 0.68 + grainA * 0.1
        : state === "completed"
          ? 0.44 + grainA * 0.08
          : 0.22 + grainA * 0.06;

    return {
      key: `soundwave-bar-${index}`,
      rest: clampHeight(rest),
      peak: clampHeight(Math.max(rest + 0.15, peak)),
      settle: clampHeight(Math.max(1, settle)),
      duration,
      delay: index * baseDelay + grainB * 0.06,
      opacity,
    };
  });
}

function resolveSoundwaveColor(state: BridgeState, activity: number): string {
  if (state === "active" && activity > 0.5) {
    return `rgba(255, 118, 47, ${0.48 + activity * 0.1})`;
  }
  if (state === "completed") {
    return `rgba(155, 147, 137, ${0.52 - activity * 0.05})`;
  }
  return `rgba(219, 212, 203, ${0.82 - activity * 0.05})`;
}

function clampHeight(value: number): number {
  return Math.max(1, Math.min(12.5, value));
}

function fractionalNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
