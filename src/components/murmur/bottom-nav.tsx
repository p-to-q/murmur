"use client";

/**
 * BottomNav v3 — typographic footer.
 *
 * Throws out the floating pill, the icons, the colored chrome. Replaces it
 * with a single line of serif-italic words centered at the bottom of the
 * page. No card, no border, no shadow — typography directly on the cream.
 *
 *   Hum  ·  Gallery  ·  Me
 *
 * Active = coral + 1.5 px `underline-mm`. Inactive = mute, no underline.
 * Auto-hides on flow screens (vibe, studio, name, checkout) so the focused
 * page owns the bottom edge for its own CTA.
 *
 * The pattern intentionally mirrors the desktop manuscript margin: three
 * words, no icons. Mobile reads the words as a footer line; desktop reads
 * them as a marginal contents column.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { getPlayer } from "@/lib/music/tone-player";
import { useCurrentLang, useTranslator } from "@/lib/i18n";
import { NAV_ITEMS } from "./nav-items";

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const lang = useCurrentLang();
  const { resetFlow } = useMurmurStore();

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault();
    getPlayer().stop().catch(() => {});
    resetFlow();
    router.push("/");
  };

  const flowPage =
    pathname.startsWith("/vibe") ||
    pathname.startsWith("/studio") ||
    pathname.startsWith("/topup");

  const items = NAV_ITEMS.filter((it) => it.mobileNav !== false);

  if (flowPage) return null;

  return (
    <motion.nav
      initial={{ y: 18, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center md:hidden pointer-events-none"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
      }}
      aria-label="Primary navigation"
    >
      <div
        className="absolute inset-x-0 bottom-0 h-[88px]"
        style={{
          background:
            "linear-gradient(to top, #F5F1EB 38%, rgba(245,241,235,0.82) 64%, rgba(245,241,235,0) 100%)",
        }}
        aria-hidden
      />
      <ul className="pointer-events-auto relative inline-flex items-baseline gap-3 px-2">
        {items.map((item, i) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const label = t(item.labelKey) || item.fallback;
          const showSep = i > 0;

          const inner = (
            <span
              className={`relative inline-block transition-colors ${
                isActive
                  ? lang === "zh"
                    ? "font-chinese-title-italic text-[16px] text-[#FF5924] underline-mm"
                    : "font-serif-italic text-[16px] text-[#FF5924] underline-mm"
                  : lang === "zh"
                    ? "font-chinese-title text-[14px] text-[#8C8780] hover:text-[#1A1A1A]"
                    : "text-[13px] font-medium tracking-[0.01em] text-[#8C8780] hover:text-[#1A1A1A]"
              }`}
            >
              {label}
            </span>
          );

          return (
            <li key={item.href} className="inline-flex items-baseline gap-3">
              {showSep && (
                <span className="text-[#D2C9B6] text-[12px]" aria-hidden>
                  ·
                </span>
              )}
              {item.href === "/" ? (
                <button
                  onClick={goHome}
                  aria-label={label}
                  className="px-1 py-1 transition-transform active:scale-95"
                >
                  {inner}
                </button>
              ) : (
                <Link
                  href={item.href}
                  aria-label={label}
                  className="block px-1 py-1 transition-transform active:scale-95"
                  suppressHydrationWarning
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </motion.nav>
  );
}
