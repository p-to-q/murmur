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
 * replace Vibe. Same shape for everything we'll later hang off Me:
 * billing, settings, privacy, checkout, and so on.
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
    steps: [
      { match: "/topup",          labelKey: "nav.flow.topup",    fallback: "Top up"   },
      { match: "/topup/checkout", labelKey: "nav.flow.checkout", fallback: "Checkout" },
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
 * `/gallery`) — there's no sub-flow row to render in that case. Once
 * the user enters a sub-flow, all prior steps in that flow stay visible.
 */
export function computeTrail(pathname: string | null | undefined): ComputedTrail | null {
  if (!pathname) return null;
  for (const root of TRAIL_ROOTS) {
    let activeIdx = -1;
    // Longest-prefix wins, so `/studio/name` beats `/studio`.
    for (let i = root.steps.length - 1; i >= 0; i--) {
      const s = root.steps[i]!;
      if (pathname === s.match || pathname.startsWith(`${s.match}/`)) {
        activeIdx = i;
        break;
      }
    }
    if (activeIdx === -1) continue;

    const computed: ComputedStep[] = root.steps
      .slice(0, activeIdx + 1)
      .map((step, i) => ({ step, isActive: i === activeIdx }));
    return { rootHref: root.href, steps: computed };
  }
  return null;
}
