import { Mic, Grid3x3, User, type LucideIcon } from "lucide-react";
import type { TKey } from "@/lib/i18n/dict";

export type NavItem = {
  href: string;
  icon: LucideIcon;
  labelKey: TKey;
  /** Center "primary" slot — gets the round coral accent treatment on mobile */
  primary?: boolean;
};

// Three-item nav: every step in the user journey is reachable from here, and
// no orphans (Studio/Vibe are reached *through* the Hum → Pick → Studio flow,
// not from the nav directly).
export const NAV_ITEMS: NavItem[] = [
  { href: "/",        icon: Mic,     labelKey: "nav.hum" },
  { href: "/gallery", icon: Grid3x3, labelKey: "nav.gallery", primary: true },
  { href: "/me",      icon: User,    labelKey: "nav.me" },
];
