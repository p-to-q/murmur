"use client";

/**
 * SideNav v3 — typographic margin.
 *
 * Throws out the icon list, the card surface, the right-side border, and the
 * floating active-dot. Replaces them with a manuscript-style page edge:
 *
 *   - Transparent background; PageBackdrop drifts under it.
 *   - Three destinations stacked vertically, separated by hairline rules.
 *   - Active destination gets a 1.5 px coral vertical line at the row's left
 *     edge (the "margin marker" of an old book) and shifts to serif italic.
 *   - Hover: the word slides 4 px right, ink darkens.
 *   - Brand glyph at top breathes when global audio is playing.
 *   - Balance chip + language switch live at the bottom in tiny pill form.
 *
 * Two states: expanded (208 px) + collapsed (56 px). Width is read by
 * layout.tsx via `--side-nav-w` on <html.nav-collapsed>; the toggle is
 * persisted in localStorage.
 *
 * No icons in this surface. Words ARE the navigation.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { getPlayer } from "@/lib/music/tone-player";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { NAV_ITEMS, computeTrail, type ComputedStep } from "./nav-items";
import { MurmurMark } from "./murmur-mark";
import { Fragment } from "react";

const STORAGE_KEY = "murmur:side-nav-collapsed";
const ENABLE_NAV_ENTRANCE_MOTION = process.env.NODE_ENV === "production";

export function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const { resetFlow, isPlaying, auditioningVersionId } = useMurmurStore();
  const { balance } = useUserBalance();
  const audioActive = isPlaying || auditioningVersionId !== null;

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return localStorage.getItem(STORAGE_KEY) === "1";
  });
  useEffect(() => {
    const html = document.documentElement;
    if (collapsed) html.classList.add("nav-collapsed");
    else html.classList.remove("nav-collapsed");
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault();
    getPlayer().stop().catch(() => {});
    resetFlow();
    router.push("/");
  };

  const items = NAV_ITEMS.filter((it) => it.desktopNav !== false);
  // Nested rows under the active destination — a small outline that accrues
  // as the user walks through a sub-flow. Vibe -> Studio -> Name stays
  // additive: each step appears below the previous one, none replace it.
  // When the user is on a bare destination (/, /gallery, /me), trail is null
  // and the nav stays at just the three rows.
  //
  // Topup + Checkout hang off /me. Settings / billing / privacy will hang
  // off /me too once they ship. The model is general-purpose; see
  // TRAIL_ROOTS in ./nav-items for how a new sub-flow opts in.
  const trail = computeTrail(pathname);

  return (
    <aside
      className="side-nav-paper hidden md:flex fixed top-0 left-0 bottom-0 z-40 flex-col"
      style={{
        width: "var(--side-nav-w)",
        paddingTop: "max(env(safe-area-inset-top, 0px), 32px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
        transition: "width 0.36s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      aria-label="Primary navigation"
    >
      {/* ── Brand row ────────────────────────────────────────────── */}
      <div
        className={collapsed ? "relative z-10 flex justify-center px-0 mb-2" : "relative z-10 flex items-center justify-between px-7 pr-5 mb-2"}
      >
        <button
          onClick={goHome}
          aria-label="Murmur — home"
          className={collapsed ? "group inline-flex items-center justify-center" : "group inline-flex items-center justify-start"}
        >
          <AnimatePresence initial={false} mode="wait">
            {collapsed ? (
              <motion.span
                key="collapsed-glyph"
                initial={ENABLE_NAV_ENTRANCE_MOTION ? { opacity: 0, scale: 0.78, rotate: -8 } : false}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={ENABLE_NAV_ENTRANCE_MOTION ? { opacity: 0, scale: 0.84, rotate: 8 } : undefined}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="inline-flex"
              >
                <BrandGlyph audioActive={audioActive} />
              </motion.span>
            ) : (
              <motion.span
                key="expanded-mark"
                initial={ENABLE_NAV_ENTRANCE_MOTION ? { opacity: 0, x: -10, scale: 0.96 } : false}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={ENABLE_NAV_ENTRANCE_MOTION ? { opacity: 0, x: -6, scale: 0.98 } : undefined}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="transition-opacity group-hover:opacity-90"
              >
                <MurmurMark size={34} yOffset={0} className="h-[34px]" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Collapse navigation"
            className="ml-7 shrink-0 text-[#B6B0A4] hover:text-[#1A1A1A] transition-colors"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Expand navigation"
          className="relative z-10 mt-3 mx-auto text-[#B6B0A4] hover:text-[#1A1A1A] transition-colors"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      )}

      {/* ── Destinations ─────────────────────────────────────────── */}
      <nav className={collapsed ? "relative z-10 mt-10 px-0 flex flex-col items-center gap-7" : "relative z-10 mt-10 px-7"}>
        {items.map((item, i) => {
          const isActive =
            trail?.rootHref === item.href
              ? false
              : item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
          const label = t(item.labelKey) || item.fallback;

          if (collapsed) {
            return (
              <Fragment key={item.href}>
                <CollapsedDot
                  isActive={isActive}
                  onActivate={(e) => {
                    if (item.href === "/") {
                      goHome(e);
                    } else {
                      router.push(item.href);
                    }
                  }}
                  label={label}
                />
                {/* Collapsed outline — one tiny coral dot per visible sub-step. */}
                {trail && trail.rootHref === item.href &&
                  trail.steps.map((cs) => (
                    <span
                      key={cs.step.match}
                      aria-label={t(cs.step.labelKey) || cs.step.fallback}
                      title={t(cs.step.labelKey) || cs.step.fallback}
                      className={
                        cs.isActive
                          ? "block h-[5px] w-[5px] rounded-full bg-[#FF5924]"
                          : "block h-[4px] w-[4px] rounded-full bg-[#FF5924]/45"
                      }
                    />
                  ))}
              </Fragment>
            );
          }

          const body = (
            <ManuscriptRow
              label={label}
              isActive={isActive}
              showRule={i > 0}
              lang={lang}
              meta={item.href === "/topup" ? `${balance?.notes ?? "—"}` : undefined}
            />
          );
          return (
            <Fragment key={item.href}>
              {item.href === "/" ? (
                <button onClick={goHome} className="block w-full text-left">
                  {body}
                </button>
              ) : (
                <Link
                  href={item.href}
                  className="block"
                  suppressHydrationWarning
                >
                  {body}
                </Link>
              )}
              {trail && trail.rootHref === item.href && trail.steps.length > 0 && (
                <NestedTrail steps={trail.steps} lang={lang} t={t} />
              )}
            </Fragment>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* ── Footer: balance + language ───────────────────────────── */}
      <div className={collapsed ? "relative z-10 px-0 flex flex-col items-center gap-3" : "relative z-10 px-7"}>
        {!collapsed && (
          <Link
            href="/topup"
            className="group block mb-4 transition-colors"
            suppressHydrationWarning
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.22em] text-[#B6B0A4]">
                {t("nav.notes") || "notes"}
              </span>
              <span className="text-[10px] uppercase tracking-[0.22em] text-[#8C8780] group-hover:text-[#FF5924] transition-colors">
                {t("nav.topup") || "top up"}
              </span>
            </div>
            <p className="mt-1 font-serif text-[#1A1A1A] text-[24px] leading-none tabular-nums">
              {balance?.notes ?? "—"}
            </p>
            <div className="mt-3 h-px w-full bg-[#E5DDD0]" />
          </Link>
        )}

        {collapsed && (
          <Link
            href="/topup"
            className="block mb-2 text-[#1A1A1A] hover:text-[#FF5924] transition-colors"
            suppressHydrationWarning
          >
            <span className="font-serif text-[14px] tabular-nums">
              {balance?.notes ?? "—"}
            </span>
          </Link>
        )}

        <div className={collapsed ? "flex flex-col gap-0.5" : "flex gap-1"}>
          <LangSwitch
            collapsed={collapsed}
            active={lang === "zh"}
            label="中"
            onClick={() => setLang("zh")}
          />
          <LangSwitch
            collapsed={collapsed}
            active={lang === "en"}
            label="EN"
            onClick={() => setLang("en")}
          />
        </div>
      </div>
    </aside>
  );
}

/* ── Brand glyph — small disc that breathes when audio plays ───────── */

function BrandGlyph({ audioActive }: { audioActive: boolean }) {
  return (
    <span
      className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#1A1A1A] ${audioActive ? "mark-breathe" : ""}`}
      aria-hidden
    >
      <motion.span
        animate={
          audioActive
            ? { scale: [1, 1.3, 1], opacity: [1, 0.75, 1] }
            : { scale: 1, opacity: 1 }
        }
        transition={
          audioActive
            ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.3 }
        }
        className="block h-[6px] w-[6px] rounded-full bg-[#FF5924]"
      />
    </span>
  );
}

/* ── Nested trail — document-outline sub-steps ─────────────────────── */

/**
 * Renders the journey under a destination as an additive outline. Earlier
 * steps stay visible and clickable; the active step is darker but does not
 * get an underline. The small arrow and left padding are intentional: this
 * should read like a document list, not an inline breadcrumb.
 */
function NestedTrail({
  steps,
  lang,
  t,
}: {
  steps: ComputedStep[];
  lang: string;
  t: (key: string) => string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
      className="mt-1.5 mb-6 ml-5 flex flex-col gap-1.5"
    >
      {steps.map((cs) => {
        const label = t(cs.step.labelKey) || cs.step.fallback;
        const textCls = cs.isActive
          ? lang === "zh"
            ? "font-chinese-title-italic text-[18px] text-[#1A1A1A]"
            : "font-serif-italic text-[20px] text-[#1A1A1A]"
          : lang === "zh"
            ? "font-chinese-title-italic text-[18px] text-[#8C8780] hover:text-[#1A1A1A]"
            : "font-serif-italic text-[20px] text-[#8C8780] hover:text-[#1A1A1A]";
        const content = (
          <span className="group/sub flex items-baseline gap-2.5 leading-none">
            <span
              aria-hidden
              className={`text-[15px] leading-none transition-colors ${
                cs.isActive
                  ? "text-[#FF5924]"
                  : "text-[#FF5924]/75 group-hover/sub:text-[#FF5924]"
              }`}
            >
              ↪
            </span>
            <span className={`${textCls} transition-colors`}>{label}</span>
          </span>
        );

        return cs.isActive ? (
          <div key={cs.step.match} aria-current="page">
            {content}
          </div>
        ) : (
          <Link
            key={cs.step.match}
            href={cs.step.match}
            className="block"
            suppressHydrationWarning
          >
            {content}
          </Link>
        );
      })}
    </motion.div>
  );
}

/* ── Expanded destination row — "manuscript style" ─────────────────── */

function ManuscriptRow({
  label,
  isActive,
  showRule,
  lang,
  meta,
}: {
  label: string;
  isActive: boolean;
  showRule: boolean;
  lang: string;
  meta?: string;
}) {
  return (
    <div className={`group relative ${showRule ? "pt-4 mt-4 border-t border-[#E5DDD0]/70" : "pt-2"}`}>
      {/* Margin marker — coral hairline at the row's left edge */}
      <span
        className={`absolute left-[-28px] top-1/2 -translate-y-1/2 h-7 w-[1.5px] bg-[#FF5924] transition-opacity duration-300 ${isActive ? "opacity-100" : "opacity-0"}`}
        aria-hidden
      />
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`transition-all duration-200 group-hover:translate-x-[3px] ${
            isActive
              ? lang === "zh"
                ? "font-chinese-title-italic text-[24px] text-[#1A1A1A]"
                : "font-serif-italic text-[25px] text-[#1A1A1A]"
              : lang === "zh"
                ? "font-chinese-title text-[18px] text-[#8C8780] group-hover:text-[#1A1A1A]"
                : "font-serif text-[20px] tracking-[0.005em] text-[#8C8780] group-hover:text-[#1A1A1A]"
          }`}
        >
          {label}
        </span>
        {meta && (
          <span className="text-[11px] tabular-nums text-[#B6B0A4]">{meta}</span>
        )}
      </div>
    </div>
  );
}

/* ── Collapsed destination — a single dot ──────────────────────────── */

function CollapsedDot({
  isActive,
  onActivate,
  label,
}: {
  isActive: boolean;
  onActivate: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <button
      onClick={onActivate}
      aria-label={label}
      title={label}
      className="group relative flex h-7 w-7 items-center justify-center"
    >
      <span
        className={`h-[8px] w-[8px] rounded-full transition-all duration-200 ${
          isActive
            ? "bg-[#FF5924] scale-100"
            : "bg-transparent border border-[#B6B0A4] scale-90 group-hover:border-[#1A1A1A] group-hover:scale-100"
        }`}
      />
    </button>
  );
}

/* ── Tiny language switch ──────────────────────────────────────────── */

function LangSwitch({
  collapsed,
  active,
  label,
  onClick,
}: {
  collapsed: boolean;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md transition-colors text-[10px] tracking-[0.04em] ${
        collapsed ? "h-5 w-5" : "h-6 px-2"
      } ${
        active
          ? "text-[#1A1A1A]"
          : "text-[#B6B0A4] hover:text-[#1A1A1A]"
      }`}
    >
      {label}
    </button>
  );
}
