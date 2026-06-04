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
 * v2 nav surface — three destinations only.
 *
 * Vibe + Studio are FLOW screens, not destinations: the user reaches them by
 * humming, picking, or editing. Surfacing them as nav items in v1 muddied
 * the journey ("am I starting over? am I editing nothing?").
 *
 * Hum (/), Gallery (/gallery), Me (/me) cover the three jobs:
 *   - make something new
 *   - look at what you've made
 *   - reflect on who you are here
 *
 * Top-up is reached from the Notes card in Me + balance chip in the side nav,
 * not from nav. Keeping it out of the nav protects the editorial calm.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/",        icon: CreateNavIcon,  labelKey: "nav.create",  fallback: "Hum" },
  { href: "/gallery", icon: GalleryNavIcon, labelKey: "nav.gallery", fallback: "Gallery" },
  { href: "/me",      icon: MeNavIcon,      labelKey: "nav.me",      fallback: "Me" },
];
