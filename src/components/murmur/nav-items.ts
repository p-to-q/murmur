import type { ComponentType, SVGProps } from "react";
import type { TKey } from "@/lib/i18n/dict";
import {
  CreateNavIcon,
  VibeNavIcon,
  StudioNavIcon,
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
  /** false = hide from mobile bottom nav (default: true) */
  mobileNav?: boolean;
  /** false = hide from desktop sidebar (default: true) */
  desktopNav?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", icon: CreateNavIcon, labelKey: "nav.create" },
  // /vibe redirects to / — orphaned, hidden from all navs
  { href: "/vibe", icon: VibeNavIcon, labelKey: "nav.vibe", mobileNav: false, desktopNav: false },
  // Studio is reached via the hum→pick flow on mobile; desktop users can navigate directly
  { href: "/studio", icon: StudioNavIcon, labelKey: "nav.studio", mobileNav: false },
  { href: "/gallery", icon: GalleryNavIcon, labelKey: "nav.gallery" },
  { href: "/me", icon: MeNavIcon, labelKey: "nav.me" },
];
