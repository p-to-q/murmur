import type { ComponentType, SVGProps } from "react";
import type { TKey } from "@/lib/i18n/dict";
import {
  CreateNavIcon,
  GalleryNavIcon,
  MeNavIcon,
} from "./nav-icons";

export type NavIconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { active?: boolean }
>;

export type NavItem = {
  href: string;
  icon: NavIconComponent;
  labelKey: TKey;
  /** Display label in English when i18n key is missing. */
  fallback: string;
  /** false = hide from mobile bottom nav (default: true) */
  mobileNav?: boolean;
  /** false = hide from desktop sidebar (default: true) */
  desktopNav?: boolean;
};

/**
 * Top-level destinations — three rows that always sit in the side nav.
 * Everything else (Vibe, Studio, Name, Topup, Checkout, Settings, …) is a
 * sub-step inside one of these destinations' territories. See TRAIL_ROOTS
 * for the per-destination trail model.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/",        icon: CreateNavIcon,  labelKey: "nav.create",  fallback: "Hum" },
  { href: "/gallery", icon: GalleryNavIcon, labelKey: "nav.gallery", fallback: "Gallery" },
  { href: "/me",      icon: MeNavIcon,      labelKey: "nav.me",      fallback: "Me" },
];

export type MobileJourneyStep = {
  href: string;
  labelKey: TKey;
  fallback: string;
  /** `0` keeps the step visible on the landing rail. */
  unlockAt: number;
  emphasis: "start" | "mid" | "end";
};

/**
 * Narrow-screen journey rail.
 *
 * The line always starts with Create and ends with Gallery. Middle stops
 * appear as the user advances through the flow so the strip reads as both a
 * progress line and a set of tappable waypoints.
 */
export const MOBILE_JOURNEY_STEPS: MobileJourneyStep[] = [
  { href: "/",        labelKey: "nav.create",       fallback: "Create",  unlockAt: 0, emphasis: "start" },
  { href: "/vibe",    labelKey: "nav.flow.vibe",   fallback: "Vibe",    unlockAt: 1, emphasis: "mid"   },
  { href: "/studio",  labelKey: "nav.flow.studio", fallback: "Studio",  unlockAt: 2, emphasis: "mid"   },
  { href: "/studio/name", labelKey: "nav.flow.name", fallback: "Name it", unlockAt: 3, emphasis: "mid"   },
  { href: "/gallery", labelKey: "nav.gallery",     fallback: "Gallery", unlockAt: 0, emphasis: "end"   },
];

/**
 * Resolve the deepest mobile journey stage represented by a pathname.
 *
 * Returns:
 *   - `-1` for routes outside the create/gallery rail
 *   - `0` for the landing/home stage
 *   - `1` for Vibe
 *   - `2` for Studio
 *   - `3` for Name it
 *   - `4` for Gallery / Song detail
 */
export function resolveMobileJourneyStage(pathname: string | null | undefined): number {
  if (!pathname) return -1;
  if (pathname === "/" || pathname.startsWith("/vibe")) return pathname === "/" ? 0 : 1;
  if (pathname.startsWith("/studio/name")) return 3;
  if (pathname.startsWith("/studio")) return 2;
  if (pathname.startsWith("/gallery") || pathname.startsWith("/song")) return 4;
  return -1;
}

/* ── Nested nav model ────────────────────────────────────────────────
 *
 * The side nav grows like a small document outline. Sub-steps are
 * additive, not replacing:
 *
 *   Create
 *      ↪ Vibe
 *      ↪ Studio
 *   Gallery
 *   Me!
 *
 * Reaching Studio should reveal Studio under Vibe; it should not
 * replace Vibe. Me's personal-center pages use the same parent territory,
 * but only the current child appears under Me instead of exposing the whole
 * account menu at once.
 */

export interface TrailStep {
  /** Pathname or pathname-prefix that places this step in scope. */
  match: string;
  labelKey: TKey;
  fallback: string;
}

export interface TrailRoot {
  /** Must equal a NAV_ITEMS[].href entry — the destination this trail hangs under. */
  href: string;
  /** Steps in chronological order; visible rows build top-to-bottom. */
  steps: TrailStep[];
  /**
   * Additive roots show every previous step up to the current one. Single
   * roots show only the current matching child.
   */
  mode?: "additive" | "single";
}

export const TRAIL_ROOTS: TrailRoot[] = [
  {
    href: "/",
    steps: [
      { match: "/vibe",        labelKey: "nav.flow.vibe",   fallback: "Vibe"    },
      { match: "/studio",      labelKey: "nav.flow.studio", fallback: "Studio"  },
      { match: "/studio/name", labelKey: "nav.flow.name",   fallback: "Name it" },
    ],
  },
  {
    href: "/me",
    mode: "single",
    steps: [
      { match: "/me/settings",    labelKey: "nav.flow.settings",        fallback: "Settings"        },
      { match: "/me/notifications", labelKey: "nav.flow.notifications",  fallback: "Notifications"   },
      { match: "/me/payments",    labelKey: "nav.flow.payment_records", fallback: "Payment records" },
      { match: "/me/privacy",     labelKey: "nav.flow.privacy",         fallback: "Privacy"         },
      { match: "/me/delete",      labelKey: "nav.flow.delete_account",  fallback: "Delete account"  },
      { match: "/topup",          labelKey: "nav.flow.topup",           fallback: "Top up"          },
      { match: "/topup/checkout", labelKey: "nav.flow.checkout",        fallback: "Checkout"        },
    ],
  },
  {
    href: "/gallery",
    mode: "single",
    steps: [
      { match: "/song", labelKey: "nav.flow.song", fallback: "Song" },
    ],
  },
];

export interface ComputedStep {
  step: TrailStep;
  isActive: boolean;
}

export interface ComputedTrail {
  /** href of the parent destination this trail belongs under. */
  rootHref: string;
  steps: ComputedStep[];
}

/**
 * Resolve the nested rows for a pathname.
 *
 * Returns null when the user is on a bare destination (e.g. `/`, `/me`,
 * `/gallery`) because there's no child row to render yet. Additive roots
 * reveal prior steps in a flow; single roots reveal only the active child.
 */
export function computeTrail(
  pathname: string | null | undefined,
  options: { notificationsEnabled?: boolean } = {},
): ComputedTrail | null {
  if (!pathname) return null;
  for (const root of TRAIL_ROOTS) {
    const notificationStep = root.steps.find((step) => step.match === "/me/notifications");
    const steps =
      root.href === "/me" && options.notificationsEnabled === false
        ? root.steps.filter((step) => step.match !== "/me/notifications")
        : root.steps;
    let activeIdx = -1;
    // Longest-prefix wins, so `/studio/name` beats `/studio`.
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i]!;
      if (pathname === s.match || pathname.startsWith(`${s.match}/`)) {
        activeIdx = i;
        break;
      }
    }
    if (activeIdx === -1) {
      if (
        root.href === "/me" &&
        options.notificationsEnabled &&
        notificationStep &&
        (pathname === "/me" || pathname.startsWith("/me/"))
      ) {
        return {
          rootHref: root.href,
          steps: [{ step: notificationStep, isActive: false }],
        };
      }
      continue;
    }

    const visibleSteps = root.mode === "single"
      ? steps.slice(activeIdx, activeIdx + 1)
      : steps.slice(0, activeIdx + 1);
    const visibleWithPersistentNotification =
      root.href === "/me" &&
      options.notificationsEnabled &&
      notificationStep &&
      !visibleSteps.some((step) => step.match === notificationStep.match)
        ? [notificationStep, ...visibleSteps]
        : visibleSteps;
    const computed: ComputedStep[] = visibleWithPersistentNotification.map((step) => ({
      step,
      isActive:
        pathname === step.match || pathname.startsWith(`${step.match}/`),
    }));
    return { rootHref: root.href, steps: computed };
  }
  return null;
}
