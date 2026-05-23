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
  { href: "/vibe", icon: VibeNavIcon, labelKey: "nav.vibe" },
  { href: "/studio", icon: StudioNavIcon, labelKey: "nav.studio" },
  // Create sits in the visual centre on mobile, second from top on desktop
  { href: "/", icon: CreateNavIcon, labelKey: "nav.create" },
  { href: "/gallery", icon: GalleryNavIcon, labelKey: "nav.gallery" },
  { href: "/me", icon: MeNavIcon, labelKey: "nav.me" },
];
