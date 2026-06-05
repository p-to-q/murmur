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
import { motion, AnimatePresence } from "framer-motion";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { getPlayer } from "@/lib/music/tone-player";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import { NAV_ITEMS } from "./nav-items";

/** Routes where the footer line fades out so a focused flow owns the bottom.
 *  Hum (`/`) belongs here too: the user is already in the capture moment,
 *  the orb is the action, and Hum's own bottom bar (brand mark + CTA pill)
 *  is the only bottom content the page needs. */
const HIDE_ON: string[] = ["/", "/studio", "/vibe", "/topup/checkout", "/studio/name"];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const { resetFlow } = useMurmurStore();

  const isHidden = HIDE_ON.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault();
    getPlayer().stop().catch(() => {});
    resetFlow();
    router.push("/");
  };

  const items = NAV_ITEMS.filter((it) => it.mobileNav !== false);

  return (
    <AnimatePresence>
      {!isHidden && (
        <motion.nav
          key="bottom-nav"
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 18, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-0 z-50 flex justify-center md:hidden pointer-events-none"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
          }}
          aria-label="Primary navigation"
        >
          <ul className="pointer-events-auto inline-flex items-baseline gap-3 px-2">
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
                    >
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}
