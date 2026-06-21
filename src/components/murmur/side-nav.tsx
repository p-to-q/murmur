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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, LinkIcon, LogIn } from "lucide-react";
import { createPortal } from "react-dom";

import { getShareInviteUrl } from "@/lib/api/share-links";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { getPlayer } from "@/lib/music/tone-player";
import { versionPreview } from "@/lib/music/version-preview";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { useBrowserNotification } from "@/lib/hooks/use-browser-notification";
import { NAV_ITEMS, computeTrail, type ComputedStep } from "./nav-items";
import { MurmurMark } from "./murmur-mark";
import { ShareCardModal } from "./share-card-modal";
import { Fragment } from "react";

const STORAGE_KEY = "murmur:side-nav-collapsed";
const ENABLE_NAV_ENTRANCE_MOTION = true;

const collapsedListeners = new Set<() => void>();

function readCollapsedPreference(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "1" || stored === "true";
}

function subscribeCollapsedPreference(onStoreChange: () => void) {
  collapsedListeners.add(onStoreChange);
  return () => {
    collapsedListeners.delete(onStoreChange);
  };
}

function writeCollapsedPreference(next: boolean) {
  localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  for (const listener of collapsedListeners) listener();
}

function useSideNavCollapsed() {
  const collapsed = useSyncExternalStore(
    subscribeCollapsedPreference,
    readCollapsedPreference,
    () => false,
  );

  return [collapsed, writeCollapsedPreference] as const;
}

function SideNavInner({ onShareClick }: { onShareClick: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const { balance } = useUserBalance();
  const { resetFlow, isPlaying, auditioningVersionId } = useMurmurStore();
  const audioActive = isPlaying || auditioningVersionId !== null;
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  const [slashFlash, setSlashFlash] = useState(false);
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useSideNavCollapsed();

  useEffect(() => {
    const html = document.documentElement;
    if (collapsed) html.classList.add("nav-collapsed");
    else html.classList.remove("nav-collapsed");
  }, [collapsed]);

  useEffect(() => {
    versionPreview.stop();
  }, [pathname]);

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault();
    setOptimisticPath("/");
    getPlayer().stop().catch(() => {});
    versionPreview.stop();
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
  const effectivePath = optimisticPath ?? pathname;
  const trail = computeTrail(effectivePath);

  useEffect(() => {
    if (optimisticPath === null) return;
    if (pathname !== optimisticPath) return;
    const id = window.setTimeout(() => setOptimisticPath(null), 0);
    return () => window.clearTimeout(id);
  }, [pathname, optimisticPath]);

  return (
    <aside
      className="side-nav-paper hidden md:flex fixed top-0 left-0 bottom-0 z-40 flex-col"
      style={{
        width: "var(--side-nav-w)",
        paddingTop: "max(env(safe-area-inset-top, 0px), 44px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
        // Width: fast transition (0.3s)
        // Border-radius: delayed start (0.25s delay) + very slow transition (0.8s)
        transition: collapsed
          ? "width 0.3s cubic-bezier(0.22, 1, 0.36, 1), border-top-right-radius 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.25s, border-bottom-right-radius 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.25s"
          : "width 0.3s cubic-bezier(0.22, 1, 0.36, 1), border-top-right-radius 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-bottom-right-radius 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
        borderTopRightRadius: collapsed ? "16px" : "0px",
        borderBottomRightRadius: collapsed ? "16px" : "0px",
        overflow: "hidden",
      }}
      aria-label="Primary navigation"
    >
      {/* ── Brand area — abs-positioned children for smooth transition ── */}
      <div className="relative z-10 h-[60px]">
        {/* Brand glyph — visible when collapsed */}
        <button
          onClick={goHome}
          aria-label="Murmur — home"
          className={`absolute inline-flex items-center justify-center transition-opacity duration-200 ${
            collapsed ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          style={{ left: 34, top: 4, transform: "translateX(-50%)" }}
        >
          <BrandGlyph audioActive={audioActive} />
        </button>

        {/* Brand mark — visible when expanded */}
        <button
          onClick={goHome}
          aria-label="Murmur — home"
          className={`absolute group transition-opacity duration-200 ${
            collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
          style={{ left: 28, top: "50%", transform: "translateY(-50%)" }}
        >
          <span className="transition-opacity group-hover:opacity-90">
            <MurmurMark size={34} yOffset={0} className="h-[34px]" />
          </span>
        </button>

        {/* Collapse/expand toggle — single button, position transitions */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="absolute text-[#B6B0A4] hover:text-[#1A1A1A] transition-colors"
          style={{
            left: collapsed ? 34 : 293,
            top: collapsed ? 49 : 30,
            transform: "translate(-50%, -50%)",
            transition: "left 0.3s cubic-bezier(0.22, 1, 0.36, 1), top 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <span
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
              collapsed ? "opacity-0" : "opacity-100"
            }`}
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </span>
          <span
            className={`flex items-center justify-center transition-opacity duration-200 ${
              collapsed ? "opacity-100" : "opacity-0"
            }`}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>

      {/* ── Destinations ─────────────────────────────────────────── */}
      <LayoutGroup id="side-nav">
        <nav
          className="relative z-10 mt-12"
          style={{
            paddingLeft: collapsed ? 0 : 28,
            paddingRight: collapsed ? 0 : 28,
            transition: "padding 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {items.map((item, i) => {
          const isActive =
            trail?.rootHref === item.href
              ? false
              : item.href === "/"
                ? effectivePath === "/"
                : effectivePath.startsWith(item.href);
          const label = t(item.labelKey) || item.fallback;

          const textCls = isActive
            ? lang === "zh"
              ? "font-chinese-title-italic text-[24px] text-[#1A1A1A]"
              : "font-serif-italic text-[25px] text-[#1A1A1A]"
            : lang === "zh"
              ? "font-chinese-title text-[18px] text-[#8C8780] group-hover:text-[#1A1A1A]"
              : "font-serif text-[20px] tracking-[0.005em] text-[#8C8780] group-hover:text-[#1A1A1A]";

          const row = (
            <div
              className={i > 0 ? "pt-4 mt-4 border-t" : "pt-2"}
              style={i > 0 ? { borderColor: collapsed ? "transparent" : "rgba(229,221,208,0.7)", transition: "border-color 0.3s" } : undefined}
            >
              <div className="relative flex h-9 items-center">
                {/* Dot — crossfades in when collapsed */}
                <div
                  className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
                    collapsed ? "opacity-100" : "opacity-0 pointer-events-none"
                  }`}
                >
                  <span
                    className={`h-[8px] w-[8px] rounded-full transition-all duration-200 ${
                      isActive
                        ? "bg-[#FF5924] scale-100"
                        : "bg-transparent border border-[#B6B0A4] scale-90 group-hover:border-[#1A1A1A] group-hover:scale-100"
                    }`}
                  />
                </div>
                {/* Text — crossfades in when expanded */}
                <div
                  className={`w-full transition-opacity duration-200 ${
                    collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="side-nav-active-marker"
                      className={`absolute -left-7 top-1/2 h-9 w-[3px] -translate-y-1/2 overflow-visible transition-opacity duration-200 ${collapsed ? "opacity-0" : "opacity-100"}`}
                      initial={false}
                      transition={{
                        layout: { duration: 0.46, ease: [0.16, 1, 0.3, 1] },
                      }}
                      aria-hidden
                    >
                      <span className="block h-full w-full rounded-r-[2px] bg-[#FF5924]" />
                    </motion.span>
                  )}
                  <span
                    className={`transition-all duration-200 group-hover:translate-x-[3px] ${textCls}`}
                  >
                    {label}
                  </span>
                </div>
              </div>
            </div>
          );

          return (
            <Fragment key={item.href}>
              {item.href === "/" ? (
                <button onClick={goHome} onPointerDown={() => setOptimisticPath("/")} className="block w-full text-left group">
                  {row}
                </button>
              ) : (
                <Link
                  href={item.href}
                  onPointerDown={() => setOptimisticPath(item.href)}
                  onClick={() => setOptimisticPath(item.href)}
                  className="block group"
                  suppressHydrationWarning
                >
                  {row}
                </Link>
              )}
              {!collapsed && trail && trail.rootHref === item.href && trail.steps.length > 0 && (
                <NestedTrail steps={trail.steps} lang={lang} t={t} />
              )}
              {collapsed && trail && trail.rootHref === item.href &&
                trail.steps.map((cs) => (
                  <div key={cs.step.match} className="mt-1.5 flex justify-center">
                    <span
                      aria-label={t(cs.step.labelKey) || cs.step.fallback}
                      title={t(cs.step.labelKey) || cs.step.fallback}
                      className={
                        cs.isActive
                          ? "block h-[5px] w-[5px] rounded-full bg-[#FF5924]"
                          : "block h-[4px] w-[4px] rounded-full bg-[#FF5924]/45"
                      }
                    />
                  </div>
                ))}
            </Fragment>
          );
          })}
        </nav>
      </LayoutGroup>

      <div className="flex-1" />

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className={collapsed ? "relative z-10 px-0 flex flex-col items-center gap-5" : "relative z-10 px-7 space-y-4"}>

        {/* Share / Login card — expanded only */}
        {!collapsed && (
          isLoggedIn ? (
            <button
              onClick={onShareClick}
              className="group flex w-full items-center gap-3 rounded-[15px] border border-[#E5DDD0] bg-white/50 px-4 py-3.5 text-left transition-colors hover:border-[#FF5924]/40 hover:bg-white/70"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F5F1EB] text-[#8C8780] group-hover:text-[#FF5924] transition-colors">
                <LinkIcon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[#1A1A1A] leading-tight truncate">
                  {t("nav.share")}
                </p>
                <p className="text-[11px] text-[#B6B0A4] leading-tight mt-0.5">
                  {t("nav.share.reward")}
                </p>
              </div>
              <span className="text-[#B6B0A4] group-hover:text-[#FF5924] transition-colors text-[13px]">›</span>
            </button>
          ) : (
            <button
              onClick={onShareClick}
              className="group flex w-full items-center gap-3 rounded-[15px] border border-[#E5DDD0] bg-white/50 px-4 py-3.5 text-left transition-colors hover:border-[#FF5924]/40 hover:bg-white/70"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F5F1EB] text-[#8C8780] transition-colors group-hover:text-[#FF5924]">
                <LogIn className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[#1A1A1A] leading-tight truncate">
                  {t("nav.login")}
                </p>
                <p className="text-[11px] text-[#B6B0A4] leading-tight mt-0.5">
                  {t("nav.login.reward")}
                </p>
              </div>
              <span className="text-[#B6B0A4] group-hover:text-[#FF5924] transition-colors text-[13px]">›</span>
            </button>
          )
        )}

        {/* Balance — two-pool expression: paid + daily-free, with top-up link right-aligned */}
        {!collapsed && (
          <div className="space-y-1.5">
            <div className="flex items-baseline gap-1">
              <span className="font-serif text-[#1A1A1A] text-[28px] leading-none tabular-nums">
                {balance?.notes ?? "—"}
              </span>
              <span className="text-[12px] uppercase tracking-[0.18em] text-[#B6B0A4] leading-none">
                +
              </span>
              <span className="font-serif text-[#8C8780] text-[18px] leading-none tabular-nums">
                5
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-[0.18em] text-[#B6B0A4]">
                {t("nav.notes")}
              </span>
              <Link
                href="/topup"
                className="text-[10px] uppercase tracking-[0.18em] text-[#B6B0A4] hover:text-[#FF5924] transition-colors"
                suppressHydrationWarning
              >
                {t("nav.topup")} →
              </Link>
            </div>
          </div>
        )}

        {collapsed && (
          <Link
            href="/topup"
            className="block text-[#1A1A1A] hover:text-[#FF5924] transition-colors"
            suppressHydrationWarning
          >
            <span className="font-serif text-[14px] tabular-nums">
              {(balance?.notes ?? 0) + 5}
            </span>
          </Link>
        )}

        {/* Icon row — Language LEFT bottom, Device + Bell RIGHT bottom */}
        {!collapsed && (
          <div className="flex items-end justify-between">
            {/* Language switch — LEFT, slash baseline aligned with icon buttons */}
            <div className="flex items-baseline gap-1.5">
              <button
                onClick={() => {
                  setLang("zh");
                  setSlashFlash(true);
                  setTimeout(() => setSlashFlash(false), 200);
                }}
                className={`text-[13px] transition-colors ${
                  lang === "zh" ? "text-[#1A1A1A]" : "text-[#B6B0A4] hover:text-[#1A1A1A]"
                }`}
              >
                中
              </button>
              <span
                className={`text-[18px] leading-none transition-colors duration-200 ${
                  slashFlash ? "text-[#1A1A1A]" : "text-[#B6B0A4]"
                }`}
              >
                /
              </span>
              <button
                onClick={() => {
                  setLang("en");
                  setSlashFlash(true);
                  setTimeout(() => setSlashFlash(false), 200);
                }}
                className={`text-[13px] transition-colors ${
                  lang === "en" ? "text-[#1A1A1A]" : "text-[#B6B0A4] hover:text-[#1A1A1A]"
                }`}
              >
                EN
              </button>
            </div>
            {/* Device + Notifications — RIGHT */}
            <div className="flex items-center gap-2">
              <PopoverButton
                icon={<DeviceIcon className="h-4 w-4" />}
                label={t("nav.device.title")}
                title={t("nav.device.title")}
                body={t("nav.device.desc")}
              />
              <NotificationBellButton />
            </div>
          </div>
        )}

        {collapsed && (
          <div className="flex flex-col items-center gap-3.5">
            <NotificationBellButton chromeless />
            <button
              onClick={() => setLang(lang === "zh" ? "en" : "zh")}
              className="text-[11px] tracking-[0.06em] text-[#B6B0A4] hover:text-[#1A1A1A] transition-colors"
            >
              {lang === "zh" ? "中" : "EN"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/* ── ShareCardModal portal — must be outside <aside> to cover full viewport ── */
export function SideNavWithModal() {
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareInviteUrl, setShareInviteUrl] = useState<string | null>(null);
  const t = useTranslator();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    void getShareInviteUrl(window.location.origin).then((url) => {
      if (!cancelled) setShareInviteUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, status]);

  const handleShareClick = () => {
    setShareModalOpen(true);
    if (!shareInviteUrl) {
      void (async () => {
        const url = typeof window === "undefined"
          ? ""
          : await getShareInviteUrl(window.location.origin);
        setShareInviteUrl(url);
      })();
    }
  };

  return (
    <>
      <SideNavInner onShareClick={handleShareClick} />
      <ShareCardModal open={shareModalOpen} onClose={() => setShareModalOpen(false)} shareUrl={shareInviteUrl} />
    </>
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
    <div className={`group ${showRule ? "pt-4 mt-4 border-t border-[#E5DDD0]/70" : "pt-2"}`}>
      {/* Marker anchors against the label row (not the outer container) so
          padding above doesn't push it off-center. items-center + h-9 marker
          on the inner flex = coral bar's vertical midpoint lines up exactly
          with the glyph's. Marker is taller than the active label glyph and
          one-third thicker so it reads as a real margin tick rather than a
          hair line. Left side is square (flush with edge), right side is rounded. */}
      <div className="relative flex h-9 items-center justify-between gap-3">
        {isActive && (
          <motion.span
            layoutId="side-nav-active-marker"
            className="absolute -left-7 top-1/2 h-9 w-[3px] -translate-y-1/2 overflow-visible"
            initial={false}
            transition={{
              layout: { duration: 0.46, ease: [0.16, 1, 0.3, 1] },
            }}
            aria-hidden
          >
            <span className="block h-full w-full rounded-r-[2px] bg-[#FF5924]" />
          </motion.span>
        )}
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
  onPointerDown,
  onActivate,
  label,
}: {
  isActive: boolean;
  onPointerDown: () => void;
  onActivate: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <button
      onPointerDown={onPointerDown}
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

/* ── Custom icons — laptop+phone duo, bell notification ───── */

function DeviceIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M15.75 9.75C15.75 9.33579 15.4142 9 15 9H13.5C13.0858 9 12.75 9.33579 12.75 9.75V14.25C12.75 14.6642 13.0858 15 13.5 15H15C15.4142 15 15.75 14.6642 15.75 14.25V9.75ZM12.75 8.25V4.5C12.75 4.30109 12.6709 4.11038 12.5303 3.96973C12.3896 3.82907 12.1989 3.75 12 3.75H3C2.80109 3.75 2.61038 3.82907 2.46973 3.96973C2.32907 4.11038 2.25 4.30109 2.25 4.5V9.75C2.25 9.94891 2.32907 10.1396 2.46973 10.2803C2.61038 10.4209 2.80109 10.5 3 10.5H12C12.4142 10.5 12.75 10.8358 12.75 11.25C12.75 11.6642 12.4142 12 12 12H8.25V13.5H9C9.41421 13.5 9.75 13.8358 9.75 14.25C9.75 14.6642 9.41421 15 9 15H5.25C4.83579 15 4.5 14.6642 4.5 14.25C4.5 13.8358 4.83579 13.5 5.25 13.5H6.75V12H3C2.40326 12 1.83114 11.7628 1.40918 11.3408C0.987223 10.9189 0.75 10.3467 0.75 9.75V4.5C0.75 3.90326 0.987223 3.33114 1.40918 2.90918C1.83114 2.48722 2.40326 2.25 3 2.25H12C12.5967 2.25 13.1689 2.48722 13.5908 2.90918C14.0128 3.33114 14.25 3.90326 14.25 4.5V8.25C14.25 8.66421 13.9142 9 13.5 9C13.0858 9 12.75 8.66421 12.75 8.25ZM17.25 14.25C17.25 15.4926 16.2426 16.5 15 16.5H13.5C12.2574 16.5 11.25 15.4926 11.25 14.25V9.75C11.25 8.50736 12.2574 7.5 13.5 7.5H15C16.2426 7.5 17.25 8.50736 17.25 9.75V14.25Z" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M9 1.5C11.9204 1.5 14.3283 3.79001 14.4741 6.70679L14.6082 9.39771C14.6134 9.50151 14.6402 9.60308 14.6865 9.6958L15.6064 11.5364L15.6687 11.6814C15.7223 11.8293 15.75 11.9858 15.75 12.1436C15.7498 12.8926 15.1426 13.4998 14.3936 13.5H12.6746C12.3271 15.2116 10.8142 16.5 9 16.5C7.18581 16.5 5.67293 15.2116 5.32544 13.5H3.60645C2.90413 13.4998 2.32681 12.966 2.25732 12.282L2.25 12.1436L2.25879 11.9861C2.27699 11.83 2.32285 11.6777 2.39355 11.5364L3.31348 9.6958C3.35978 9.60306 3.38664 9.5019 3.39185 9.39844L3.52588 6.70679C3.67179 3.79002 6.07956 1.5 9 1.5ZM6.88037 13.5C7.18946 14.3735 8.02062 15 9 15C9.97936 15 10.8105 14.3735 11.1196 13.5H6.88037ZM9 3C6.87895 3 5.13052 4.66314 5.02441 6.78149L4.88965 9.47314C4.87409 9.78408 4.7944 10.0883 4.65527 10.3667L3.83862 12H14.1614L13.3447 10.3667C13.2229 10.1231 13.1468 9.85973 13.1191 9.5896L13.1104 9.47314L12.9756 6.78149C12.8695 4.66315 11.1211 3 9 3Z" />
    </svg>
  );
}

/* ── NotificationBellButton — in-app inbox + browser alert preference ───── */

function NotificationBellButton({ chromeless = false }: { chromeless?: boolean }) {
  const t = useTranslator();
  const {
    permission,
    browserAlertsEnabled,
    requestPermission,
    setBrowserAlertsEnabled,
  } = useBrowserNotification();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, isCollapsed: false, width: 240 });

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => { clearTimeout(timer); setMounted(false); };
  }, []);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const updatePosition = () => {
      if (!buttonRef.current) return;
      const button = buttonRef.current.getBoundingClientRect();
      const isCollapsed = document.documentElement.classList.contains("nav-collapsed");
      const popoverHeight = 70;
      if (isCollapsed) {
        setPosition({ left: button.right + 12, top: button.top - 4, isCollapsed: true, width: 264 });
      } else {
        setPosition({ left: 28, top: button.top - popoverHeight - 8, isCollapsed: false, width: 264 });
      }
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onMouseDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  const handleClick = async () => {
    if (permission === "default") {
      await requestPermission();
      return;
    }
    setOpen((v) => !v);
  };

  const isGranted = permission === "granted";
  const isDenied = permission === "denied";
  const alertsOn = isGranted && browserAlertsEnabled;
  const body = alertsOn
    ? t("nav.notify.enabled")
    : isDenied
      ? t("nav.notify.denied")
      : t("nav.notify.desc");
  const handleAlertsToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    void setBrowserAlertsEnabled(!alertsOn);
  };

  const buttonCls = chromeless
    ? "group relative flex h-7 w-7 items-center justify-center rounded-[10px] border border-[#E5DDD0] bg-white/45 text-[#8C8780] hover:border-[#C8C0B4] hover:bg-white/70 hover:text-[#1A1A1A] transition-colors"
    : "group relative flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#E5DDD0] bg-white/40 text-[#B6B0A4] hover:text-[#1A1A1A] hover:border-[#C8C0B4] transition-colors";

  const popoverContent = open && mounted && (
    <AnimatePresence>
      <motion.div
        ref={popoverRef}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        style={{
          position: "fixed",
          left: `${position.left}px`,
          top: `${position.top}px`,
          transform: "none",
          zIndex: 9999,
          width: `${position.width}px`,
        }}
        className="min-h-[70px] rounded-[14px] border border-[#E5DDD0] bg-white p-4 shadow-[0_12px_36px_rgba(26,26,26,0.12)]"
      >
        {position.isCollapsed && (
          <>
            <div className="absolute left-0 top-[14px] -translate-x-[6px] w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[6px] border-r-[#E5DDD0]" aria-hidden />
            <div className="absolute left-0 top-[14px] -translate-x-[5px] w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[5px] border-r-white" aria-hidden />
          </>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[#1A1A1A] leading-snug">
              {t("nav.notify.title")}
            </p>
            <p className="mt-1 text-[11px] text-[#8C8780] leading-snug">
              {body}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={alertsOn}
            aria-label={t("nav.notify.title")}
            onClick={handleAlertsToggle}
            className={`relative h-[22px] w-[40px] shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1A1A]/20 ${
              alertsOn
                ? "border-[#1A1A1A] bg-[#1A1A1A]"
                : "border-[#E5DDD0] bg-[#F8F3EA]"
            }`}
          >
            <span
              className={`absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow-[0_1px_4px_rgba(26,26,26,0.18)] transition-transform ${
                alertsOn ? "translate-x-[18px]" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        aria-label={t("nav.notify.title")}
        title={t("nav.notify.title")}
        aria-expanded={open}
        className={`relative ${buttonCls}`}
      >
        <BellIcon className="h-4 w-4" />
        <span
          className={`absolute -right-1 -top-1 z-10 flex h-2.5 w-2.5 items-center justify-center rounded-full border border-[#E5DDD0] bg-white transition-[opacity,transform] duration-200 ease-out ${
            alertsOn ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0"
          }`}
          aria-hidden
        >
          <span className="h-1 w-1 rounded-full bg-[#E5DDD0]" />
        </span>
      </button>
      {mounted && createPortal(popoverContent, document.body)}
    </>
  );
}

/* ── PopoverButton — icon button that pops a small card upward ─────── */

function PopoverButton({
  icon,
  label,
  title,
  body,
  chromeless = false,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  body: string;
  chromeless?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, isCollapsed: false, width: 240 });

  // Track mount status for portal rendering (client-only)
  useEffect(() => {
    // Using setTimeout to avoid setState during render
    const timer = setTimeout(() => setMounted(true), 0);
    return () => {
      clearTimeout(timer);
      setMounted(false);
    };
  }, []);

  // 计算弹窗位置
  useEffect(() => {
    if (!open || !buttonRef.current) return;

    const updatePosition = () => {
      if (!buttonRef.current) return;
      const button = buttonRef.current.getBoundingClientRect();
      const isCollapsed = document.documentElement.classList.contains("nav-collapsed");

      // 弹窗高度约 80px（估算：padding 16px * 2 + 标题 + 正文）
      const popoverHeight = 70;

      if (isCollapsed) {
        // 收起状态：从铃铛右边向右延伸，略微向上偏移
        setPosition({
          left: button.right + 12,
          top: button.top - 4,
          isCollapsed: true,
          width: 240,
        });
      } else {
        // 展开状态：左对齐语言切换（px-7 = 28px），右对齐铃铛按钮右边缘
        // 侧边栏宽 320px，右侧 padding 28px，按钮宽 8*4=32px
        // 右边界 = 320 - 28 = 292px，按钮右边缘 = 292px
        // 左边界 = 28px
        // 弹窗宽度 = 292 - 28 = 264px
        const leftX = 28;
        const popoverWidth = 264;
        const topY = button.top - popoverHeight - 8;
        setPosition({
          left: leftX,
          top: topY,
          isCollapsed: false,
          width: popoverWidth,
        });
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open]);

  // Click outside + Escape
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const buttonCls = chromeless
    ? "flex h-7 w-7 items-center justify-center text-[#B6B0A4] hover:text-[#1A1A1A] transition-colors"
    : "flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#E5DDD0] bg-white/40 text-[#B6B0A4] hover:text-[#1A1A1A] hover:border-[#C8C0B4] transition-colors";

  const popoverContent = open && mounted && (
    <AnimatePresence>
      <motion.div
        ref={popoverRef}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        style={{
          position: "fixed",
          left: `${position.left}px`,
          top: `${position.top}px`,
          transform: "none",
          zIndex: 9999,
          width: position.isCollapsed ? "240px" : `${position.width}px`,
        }}
        className="rounded-[14px] border border-[#E5DDD0] bg-white p-4 shadow-[0_12px_36px_rgba(26,26,26,0.12)]"
      >
        {position.isCollapsed && (
          <>
            {/* 左侧三角箭头 - 外层边框 */}
            <div
              className="absolute left-0 top-[14px] -translate-x-[6px] w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[6px] border-r-[#E5DDD0]"
              aria-hidden
            />
            {/* 左侧三角箭头 - 内层白色 */}
            <div
              className="absolute left-0 top-[14px] -translate-x-[5px] w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[5px] border-r-white"
              aria-hidden
            />
          </>
        )}
        <p className="text-[13px] font-medium text-[#1A1A1A] leading-snug">
          {title}
        </p>
        <p className="mt-1 text-[11px] text-[#8C8780] leading-snug">
          {body}
        </p>
      </motion.div>
    </AnimatePresence>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        className={buttonCls}
      >
        {icon}
      </button>
      {mounted && createPortal(popoverContent, document.body)}
    </>
  );
}
