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
  /** Display label in English when i18n key is missing. */
  fallback: string;
  /** false = hide from mobile bottom nav (default: true) */
  mobileNav?: boolean;
  /** false = hide from desktop sidebar (default: true) */
  desktopNav?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/",        icon: CreateNavIcon,  labelKey: "nav.create",  fallback: "Hum" },
  { href: "/vibe",    icon: VibeNavIcon,    labelKey: "nav.vibe",    fallback: "Vibe", mobileNav: false },
  { href: "/studio",  icon: StudioNavIcon,  labelKey: "nav.studio",  fallback: "Studio", mobileNav: false },
  { href: "/gallery", icon: GalleryNavIcon, labelKey: "nav.gallery", fallback: "Gallery" },
  { href: "/me",      icon: MeNavIcon,      labelKey: "nav.me",      fallback: "Me" },
];
